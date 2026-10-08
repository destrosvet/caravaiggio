import {
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  createProject,
  parseProject,
  serializeProject,
  type CaravaiggioProject,
  type PaletteColor,
  type SourceImage,
} from "../project/model.ts";
import {
  confirmDiscardChanges,
  hasNativeProjectFiles,
  onNativeCloseRequested,
  openNativeProject,
  saveNativeProject,
} from "../platform/projectFiles.ts";
import { nearestPaletteIndex, posterizePixels } from "../core/color.ts";
import {
  generateStyledStrokes,
  strokeStylePresets,
  type StrokeGenerationSettings,
} from "../core/strokes.ts";

const steps = [
  "Image",
  "Palette",
  "Strokes",
  "Workspace",
  "Simulation",
  "Export",
];
const plannedSteps = [
  {
    title: "Generate paintable strokes.",
    description:
      "Configure the brush and convert color regions into executable stroke paths.",
  },
  {
    title: "Arrange the machine workspace.",
    description:
      "Position the canvas, paint containers, water, wiping area, and safe travel zones.",
  },
  {
    title: "Inspect the painting simulation.",
    description:
      "Preview stroke order, tool movement, paint usage, and the expected result.",
  },
  {
    title: "Validate and export.",
    description: "Run safety checks and create machine-ready GRBL G-code.",
  },
];

function readImage(file: File): Promise<SourceImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The image could not be loaded."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () =>
        reject(new Error("The file is not a supported image."));
      image.onload = () =>
        resolve({
          name: file.name,
          mimeType: file.type as SourceImage["mimeType"],
          widthPx: image.naturalWidth,
          heightPx: image.naturalHeight,
          dataUrl: String(reader.result),
        });
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function drawTransformedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  transform: CaravaiggioProject["sourceTransform"],
) {
  const fit = Math.min(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  context.save();
  context.translate(
    width * (0.5 + transform.offsetXPercent / 100),
    height * (0.5 + transform.offsetYPercent / 100),
  );
  context.rotate((transform.rotationDeg * Math.PI) / 180);
  context.scale(transform.scaleX * fit, transform.scaleY * fit);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  context.restore();
}

function drawBrushTexture(
  context: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  color: string,
  widthPx: number,
  loadLengthPx: number,
  pressure: number,
  strokeIndex: number,
) {
  const lengths = points
    .slice(1)
    .map((point, index) =>
      Math.hypot(point.x - points[index].x, point.y - points[index].y),
    );
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  let travelled = 0;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, widthPx * 0.82);
  for (let segment = 1; segment < points.length; segment++) {
    const from = points[segment - 1];
    const to = points[segment];
    const midpointDistance = travelled + lengths[segment - 1] / 2;
    const loadRemaining = Math.max(
      0,
      1 - midpointDistance / Math.max(1, loadLengthPx),
    );
    const endSoftening = Math.min(
      1,
      Math.max(
        0,
        (totalLength - midpointDistance) / Math.max(1, widthPx * 0.9),
      ),
    );
    context.globalAlpha =
      Math.min(1, 0.72 + pressure * 0.4) *
      Math.min(1, loadRemaining * 4) *
      endSoftening;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    travelled += lengths[segment - 1];
  }
  travelled = 0;
  context.fillStyle = color;
  for (let segment = 1; segment < points.length; segment++) {
    const from = points[segment - 1];
    const to = points[segment];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const normalX = -dy / length;
    const normalY = dx / length;
    const samples = Math.max(1, Math.ceil(length / 1.7));
    const bristles = Math.max(3, Math.min(22, Math.round(widthPx / 1.6)));
    for (let sample = 0; sample <= samples; sample++) {
      const along = (sample / samples) * length;
      const remaining = Math.max(
        0,
        1 - (travelled + along) / Math.max(1, loadLengthPx),
      );
      const fade = Math.min(1, remaining * 3.2);
      if (fade <= 0) continue;
      for (let bristle = 0; bristle < bristles; bristle++) {
        const noise =
          Math.sin(
            strokeIndex * 91.7 +
              segment * 37.1 +
              sample * 17.3 +
              bristle * 53.9,
          ) *
            0.5 +
          0.5;
        if (noise > 0.5 + fade * 0.48) continue;
        const offset =
          ((bristle + 0.5) / bristles - 0.5) * widthPx + (noise - 0.5) * 1.8;
        const x = from.x + (dx * sample) / samples + normalX * offset;
        const y = from.y + (dy * sample) / samples + normalY * offset;
        context.globalAlpha = Math.min(
          0.22,
          pressure * fade * (0.08 + noise * 0.14),
        );
        context.strokeStyle = bristle % 3 === 0 ? "#000000" : "#FFFFFF";
        context.lineWidth = 0.35 + noise * 0.55;
        const tangentX = dx / length;
        const tangentY = dy / length;
        const dashLength = 1.5 + noise * 4;
        context.beginPath();
        context.moveTo(
          x - (tangentX * dashLength) / 2,
          y - (tangentY * dashLength) / 2,
        );
        context.lineTo(
          x + (tangentX * dashLength) / 2,
          y + (tangentY * dashLength) / 2,
        );
        context.stroke();
      }
    }
    travelled += length;
  }
  context.globalAlpha = 1;
}

export function App() {
  const initialProject = useRef(createProject());
  const [project, setProject] = useState<CaravaiggioProject>(
    initialProject.current,
  );
  const [renderedStrokeProject, setRenderedStrokeProject] =
    useState<CaravaiggioProject>(initialProject.current);
  const [cleanSnapshot, setCleanSnapshot] = useState(() =>
    JSON.stringify(initialProject.current),
  );
  const [message, setMessage] = useState("Project is ready");
  const [activeStep, setActiveStep] = useState(0);
  const [highestUnlockedStep, setHighestUnlockedStep] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const paletteSourceCanvas = useRef<HTMLCanvasElement>(null);
  const posterizedCanvas = useRef<HTMLCanvasElement>(null);
  const strokeCanvas = useRef<HTMLCanvasElement>(null);
  const strokeViewport = useRef<HTMLDivElement>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [generationRevision, setGenerationRevision] = useState(0);
  const [strokeZoom, setStrokeZoom] = useState(1);
  const [showTrajectories, setShowTrajectories] = useState(false);
  const [strokeFitSize, setStrokeFitSize] = useState({
    width: 760,
    height: 520,
  });
  const strokePan = useRef<null | {
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  }>(null);
  const [imageSelected, setImageSelected] = useState(false);
  type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
  const transformInteraction = useRef<null | {
    mode: "move" | "resize" | "rotate";
    handle?: ResizeHandle;
    startX: number;
    startY: number;
    centerX: number;
    centerY: number;
    startAngle: number;
    boxWidth: number;
    boxHeight: number;
    transform: CaravaiggioProject["sourceTransform"];
  }>(null);
  const aspect = useMemo(
    () => project.canvas.widthMm / project.canvas.heightMm,
    [project.canvas],
  );
  const imageFrameSize = useMemo(() => {
    if (!project.sourceImage) return { widthPercent: 100, heightPercent: 100 };
    const imageAspect =
      project.sourceImage.widthPx / project.sourceImage.heightPx;
    return imageAspect > aspect
      ? { widthPercent: 100, heightPercent: (aspect / imageAspect) * 100 }
      : { widthPercent: (imageAspect / aspect) * 100, heightPercent: 100 };
  }, [aspect, project.sourceImage]);
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(project) !== cleanSnapshot,
    [project, cleanSnapshot],
  );

  const zoomStrokePreview = (
    requestedZoom: number,
    clientX?: number,
    clientY?: number,
  ) => {
    const viewport = strokeViewport.current;
    const nextZoom = Math.max(0.5, Math.min(4, requestedZoom));
    if (!viewport || nextZoom === strokeZoom) return;
    const bounds = viewport.getBoundingClientRect();
    const anchorX = (clientX ?? bounds.left + bounds.width / 2) - bounds.left;
    const anchorY = (clientY ?? bounds.top + bounds.height / 2) - bounds.top;
    const contentX = viewport.scrollLeft + anchorX;
    const contentY = viewport.scrollTop + anchorY;
    const ratio = nextZoom / strokeZoom;
    setStrokeZoom(nextZoom);
    requestAnimationFrame(() => {
      viewport.scrollLeft = contentX * ratio - anchorX;
      viewport.scrollTop = contentY * ratio - anchorY;
    });
  };

  const fitStrokePreview = () => {
    const viewport = strokeViewport.current;
    const canvas = strokeCanvas.current;
    if (!viewport || !canvas || !canvas.width || !canvas.height) return;
    const availableWidth = Math.max(1, viewport.clientWidth - 36);
    const availableHeight = Math.max(1, viewport.clientHeight - 36);
    const scale = Math.min(
      availableWidth / canvas.width,
      availableHeight / canvas.height,
    );
    setStrokeFitSize({
      width: Math.max(1, canvas.width * scale),
      height: Math.max(1, canvas.height * scale),
    });
  };

  useEffect(() => {
    const viewport = strokeViewport.current;
    if (!viewport || activeStep !== 2) return;
    const observer = new ResizeObserver(fitStrokePreview);
    observer.observe(viewport);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomStrokePreview(
        strokeZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15),
        event.clientX,
        event.clientY,
      );
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    fitStrokePreview();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", wheel);
    };
  }, [activeStep, strokeZoom]);

  const beginTransform = (
    mode: "move" | "resize" | "rotate",
    event: ReactPointerEvent<HTMLElement>,
    handle?: ResizeHandle,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const preview = event.currentTarget
      .closest(".canvas-preview")
      ?.getBoundingClientRect();
    if (!preview) return;
    const box = event.currentTarget.closest(".transform-box") as HTMLElement;
    const boxRect = box.getBoundingClientRect();
    const centerX = boxRect.left + boxRect.width / 2;
    const centerY = boxRect.top + boxRect.height / 2;
    transformInteraction.current = {
      mode,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      centerX,
      centerY,
      startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      boxWidth: box.offsetWidth,
      boxHeight: box.offsetHeight,
      transform: project.sourceTransform,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setImageSelected(true);
  };

  const updateTransform = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = transformInteraction.current;
    if (!interaction) return;
    const preview = event.currentTarget.getBoundingClientRect();
    let sourceTransform = interaction.transform;
    if (interaction.mode === "move")
      sourceTransform = {
        ...sourceTransform,
        offsetXPercent:
          interaction.transform.offsetXPercent +
          ((event.clientX - interaction.startX) / preview.width) * 100,
        offsetYPercent:
          interaction.transform.offsetYPercent +
          ((event.clientY - interaction.startY) / preview.height) * 100,
      };
    if (interaction.mode === "resize") {
      const angle = (interaction.transform.rotationDeg * Math.PI) / 180;
      const dx = event.clientX - interaction.startX;
      const dy = event.clientY - interaction.startY;
      const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
      const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
      const handle = interaction.handle ?? "se";
      const horizontal = handle.includes("e")
        ? localX
        : handle.includes("w")
          ? -localX
          : 0;
      const vertical = handle.includes("s")
        ? localY
        : handle.includes("n")
          ? -localY
          : 0;
      if (handle.length === 2) {
        const factor = Math.max(
          Math.max(
            0.1 / interaction.transform.scaleX,
            0.1 / interaction.transform.scaleY,
          ),
          Math.min(
            Math.min(
              8 / interaction.transform.scaleX,
              8 / interaction.transform.scaleY,
            ),
            1 +
              horizontal / interaction.boxWidth +
              vertical / interaction.boxHeight,
          ),
        );
        sourceTransform = {
          ...sourceTransform,
          scaleX: interaction.transform.scaleX * factor,
          scaleY: interaction.transform.scaleY * factor,
        };
      } else {
        sourceTransform = {
          ...sourceTransform,
          scaleX: horizontal
            ? Math.max(
                0.1,
                Math.min(
                  8,
                  interaction.transform.scaleX *
                    (1 + (horizontal * 2) / interaction.boxWidth),
                ),
              )
            : interaction.transform.scaleX,
          scaleY: vertical
            ? Math.max(
                0.1,
                Math.min(
                  8,
                  interaction.transform.scaleY *
                    (1 + (vertical * 2) / interaction.boxHeight),
                ),
              )
            : interaction.transform.scaleY,
        };
      }
    }
    if (interaction.mode === "rotate")
      sourceTransform = {
        ...sourceTransform,
        rotationDeg:
          interaction.transform.rotationDeg +
          ((Math.atan2(
            event.clientY - interaction.centerY,
            event.clientX - interaction.centerX,
          ) -
            interaction.startAngle) *
            180) /
            Math.PI,
      };
    setProject((current) => ({ ...current, sourceTransform }));
  };

  useEffect(() => {
    const canvas = posterizedCanvas.current;
    const sourceCanvas = paletteSourceCanvas.current;
    if (activeStep !== 1 || !canvas || !sourceCanvas || !project.sourceImage)
      return;
    const image = new Image();
    image.onload = () => {
      const detailScale = 0.2 + project.posterization.detail / 125;
      const longestEdge = Math.max(
        1,
        Math.round(
          Math.min(
            Math.max(image.naturalWidth, image.naturalHeight) * detailScale,
            900,
          ),
        ),
      );
      const width =
        aspect >= 1
          ? longestEdge
          : Math.max(1, Math.round(longestEdge * aspect));
      const height =
        aspect >= 1
          ? Math.max(1, Math.round(longestEdge / aspect))
          : longestEdge;
      canvas.width = width;
      canvas.height = height;
      sourceCanvas.width = width;
      sourceCanvas.height = height;
      const sourceContext = sourceCanvas.getContext("2d");
      if (sourceContext)
        drawTransformedImage(
          sourceContext,
          image,
          width,
          height,
          project.sourceTransform,
        );
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.filter = project.posterization.smoothing
        ? `blur(${project.posterization.smoothing / 40}px)`
        : "none";
      drawTransformedImage(
        context,
        image,
        canvas.width,
        canvas.height,
        project.sourceTransform,
      );
      context.filter = "none";
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      imageData.data.set(posterizePixels(imageData.data, project.palette));
      context.putImageData(imageData, 0, 0);
    };
    image.src = project.sourceImage.dataUrl;
  }, [
    activeStep,
    aspect,
    project.palette,
    project.posterization,
    project.sourceImage,
    project.sourceTransform,
  ]);

  useEffect(() => {
    const canvas = strokeCanvas.current;
    const sourceImage = renderedStrokeProject.sourceImage;
    if (activeStep !== 2 || !canvas || !sourceImage) return;
    const previewProject = renderedStrokeProject;
    const previewAspect =
      previewProject.canvas.widthMm / previewProject.canvas.heightMm;
    const image = new Image();
    image.onload = () => {
      const width =
        previewAspect >= 1 ? 240 : Math.max(1, Math.round(240 * previewAspect));
      const height =
        previewAspect >= 1 ? Math.max(1, Math.round(240 / previewAspect)) : 240;
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = width;
      sourceCanvas.height = height;
      const sourceContext = sourceCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!sourceContext) return;
      drawTransformedImage(
        sourceContext,
        image,
        width,
        height,
        previewProject.sourceTransform,
      );
      const pixels = sourceContext.getImageData(0, 0, width, height).data;
      const colorMap = new Uint8Array(width * height);
      for (let pixel = 0; pixel < colorMap.length; pixel++) {
        const offset = pixel * 4;
        if (pixels[offset + 3] < 16) {
          colorMap[pixel] = 255;
          continue;
        }
        colorMap[pixel] = nearestPaletteIndex(
          { r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2] },
          previewProject.palette,
        );
        if (previewProject.palette[colorMap[pixel]]?.skipPainting)
          colorMap[pixel] = 255;
      }
      const plan = generateStyledStrokes(
        previewProject.id,
        {
          widthPx: width,
          heightPx: height,
          paintIds: previewProject.palette.map((color) => color.id),
          pixels: colorMap,
        },
        previewProject.canvas,
        previewProject.brush,
        previewProject.strokeSettings,
      );
      const previewWidth = 760;
      canvas.width = previewWidth;
      canvas.height = Math.max(1, Math.round(previewWidth / previewAspect));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = "#11110f";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalAlpha = showTrajectories ? 1 : 0.9;
      context.lineCap = showTrajectories
        ? "round"
        : previewProject.brush.shape === "round"
          ? "round"
          : "square";
      const brushWidthPx = Math.max(
        1,
        (previewProject.brush.widthMm /
          Math.min(
            previewProject.canvas.widthMm,
            previewProject.canvas.heightMm,
          )) *
          Math.min(canvas.width, canvas.height),
      );
      context.lineWidth = showTrajectories ? 1 : brushWidthPx;
      for (const [strokeIndex, operation] of plan.operations.entries())
        if (operation.type === "stroke") {
          const paint = previewProject.palette.find(
            (color) => color.id === operation.paintId,
          );
          const previewPoints = operation.points.map((point) => ({
            x: (point.x / previewProject.canvas.widthMm) * canvas.width,
            y: (point.y / previewProject.canvas.heightMm) * canvas.height,
          }));
          if (showTrajectories) {
            context.strokeStyle = "#E6D39B";
            context.beginPath();
            context.moveTo(previewPoints[0].x, previewPoints[0].y);
            for (let index = 1; index < previewPoints.length - 1; index++) {
              const point = previewPoints[index];
              const next = previewPoints[index + 1];
              context.quadraticCurveTo(
                point.x,
                point.y,
                (point.x + next.x) / 2,
                (point.y + next.y) / 2,
              );
            }
            const end = previewPoints.at(-1)!;
            context.lineTo(end.x, end.y);
            context.stroke();
          } else {
            drawBrushTexture(
              context,
              previewPoints,
              paint?.hex ?? "#FFFFFF",
              brushWidthPx,
              ((previewProject.strokeSettings.paintLoadLengthMm ?? 120) /
                previewProject.canvas.widthMm) *
                canvas.width,
              operation.pressure,
              strokeIndex,
            );
          }
        }
      setStrokeCount(
        plan.operations.filter((operation) => operation.type === "stroke")
          .length,
      );
      requestAnimationFrame(fitStrokePreview);
    };
    image.src = sourceImage.dataUrl;
  }, [activeStep, generationRevision, renderedStrokeProject, showTrajectories]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    let disposed = false;
    let removeNativeListener: () => void = () => {};
    void onNativeCloseRequested(confirmDiscardChanges).then((remove) => {
      if (disposed) remove();
      else removeNativeListener = remove;
    });
    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", beforeUnload);
      removeNativeListener();
    };
  }, [hasUnsavedChanges]);

  const replaceProject = async (
    next: () => Promise<CaravaiggioProject> | CaravaiggioProject,
  ) => {
    if (hasUnsavedChanges && !(await confirmDiscardChanges())) return false;
    const replacement = await next();
    setProject(replacement);
    setCleanSnapshot(JSON.stringify(replacement));
    return true;
  };

  const patchCanvas = (key: "widthMm" | "heightMm", value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    setProject((current) => {
      const dimensions = { ...current.canvas, [key]: value };
      return {
        ...current,
        canvas: {
          ...dimensions,
          orientation:
            dimensions.widthMm > dimensions.heightMm ? "landscape" : "portrait",
        },
      };
    });
  };

  const patchPaletteColor = (id: string, patch: Partial<PaletteColor>) =>
    setProject((current) => ({
      ...current,
      palette: current.palette.map((color) =>
        color.id === id ? { ...color, ...patch } : color,
      ),
    }));
  const removePaletteColor = (id: string) =>
    setProject((current) =>
      current.palette.length === 1
        ? current
        : {
            ...current,
            palette: current.palette.filter((color) => color.id !== id),
          },
    );
  const addPaletteColor = () =>
    setProject((current) =>
      current.palette.length >= 8
        ? current
        : {
            ...current,
            palette: [
              ...current.palette,
              {
                id: crypto.randomUUID(),
                name: `Color ${current.palette.length + 1}`,
                hex: "#C7A86C",
                locked: false,
                skipPainting: false,
                restricted: false,
                hueToleranceDeg: 30,
                minimumChroma: 0.04,
              },
            ],
          },
    );
  const goToStep = (step: number) => {
    if (step === 2) setRenderedStrokeProject(project);
    setHighestUnlockedStep((current) => Math.max(current, step));
    setActiveStep(step);
  };

  const importImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !["image/png", "image/jpeg"].includes(file.type))
      return setMessage("Select a PNG or JPEG image.");
    try {
      const sourceImage = await readImage(file);
      setProject((current) => ({
        ...current,
        sourceImage,
        sourceTransform: {
          offsetXPercent: 0,
          offsetYPercent: 0,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
        },
      }));
      setMessage(
        `Loaded ${sourceImage.name} · ${sourceImage.widthPx} × ${sourceImage.heightPx} px`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    }
  };

  const fileName = () =>
    `${project.name.replace(/[^a-z0-9_-]+/gi, "-") || "projekt"}.caravaiggio.json`;

  const save = async () => {
    if (hasNativeProjectFiles) {
      try {
        const path = await saveNativeProject(
          serializeProject(project),
          fileName(),
        );
        if (path) {
          setCleanSnapshot(JSON.stringify(project));
          setMessage(`Project saved · ${path}`);
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "The project could not be saved.",
        );
      }
      return;
    }
    const blob = new Blob([serializeProject(project)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: fileName(),
    });
    link.click();
    URL.revokeObjectURL(url);
    setCleanSnapshot(JSON.stringify(project));
    setMessage("Project saved");
  };

  const chooseProject = async () => {
    if (hasUnsavedChanges && !(await confirmDiscardChanges())) return;
    if (!hasNativeProjectFiles) return projectInput.current?.click();
    try {
      const selected = await openNativeProject();
      if (!selected) return;
      const openedProject = parseProject(selected.contents);
      setProject(openedProject);
      setCleanSnapshot(JSON.stringify(openedProject));
      setMessage(`Opened project ${selected.name}`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The project could not be opened.",
      );
    }
  };

  const open = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const openedProject = parseProject(await file.text());
      setProject(openedProject);
      setCleanSnapshot(JSON.stringify(openedProject));
      setMessage(`Opened project ${file.name}`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The project could not be opened.",
      );
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div>
            <strong>Caravaiggio</strong>
            <small>painting plotter studio</small>
          </div>
        </div>
        <div className="project-actions">
          <button
            className="ghost"
            onClick={async () => {
              if (await replaceProject(() => createProject()))
                setMessage("Created a new project");
            }}
          >
            New
          </button>
          <button className="ghost" onClick={chooseProject}>
            Open
          </button>
          <button className="primary" onClick={save}>
            Save project
          </button>
        </div>
      </header>
      <nav className="steps" aria-label="Project steps">
        {steps.map((step, index) => (
          <button
            disabled={index > highestUnlockedStep}
            onClick={() => index <= highestUnlockedStep && setActiveStep(index)}
            className={
              index === activeStep
                ? "active"
                : index > highestUnlockedStep
                  ? "locked"
                  : ""
            }
            key={step}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {step}
          </button>
        ))}
      </nav>
      <main>
        {activeStep === 0 ? (
          <>
            <section className="intro">
              <p className="eyebrow">Step 01 · Source</p>
              <h1>Prepare the image for the canvas.</h1>
              <p>
                Import the source image and set its physical size. The original
                remains unchanged.
              </p>
            </section>
            <section className="workspace">
              <div className="preview-panel">
                <div className="preview-toolbar">
                  <span>Image preview</span>
                  <span>
                    {project.sourceImage
                      ? `${project.sourceImage.widthPx} × ${project.sourceImage.heightPx} px`
                      : "No source image"}
                  </span>
                </div>
                <div className="stage">
                  <div
                    className="canvas-preview"
                    style={{ aspectRatio: String(aspect) }}
                    onClick={() =>
                      project.sourceImage && setImageSelected(true)
                    }
                    onPointerMove={updateTransform}
                    onPointerUp={() => {
                      transformInteraction.current = null;
                    }}
                    onPointerCancel={() => {
                      transformInteraction.current = null;
                    }}
                  >
                    {project.sourceImage ? (
                      <div
                        className={`transform-box ${imageSelected ? "selected" : ""}`}
                        style={{
                          left: `calc(50% + ${project.sourceTransform.offsetXPercent}%)`,
                          top: `calc(50% + ${project.sourceTransform.offsetYPercent}%)`,
                          width: `${imageFrameSize.widthPercent * project.sourceTransform.scaleX}%`,
                          height: `${imageFrameSize.heightPercent * project.sourceTransform.scaleY}%`,
                          transform: `translate(-50%, -50%) rotate(${project.sourceTransform.rotationDeg}deg)`,
                        }}
                        onPointerDown={(event) => beginTransform("move", event)}
                      >
                        <img
                          src={project.sourceImage.dataUrl}
                          alt="Imported source image"
                          draggable={false}
                        />
                        {imageSelected && (
                          <>
                            {(
                              [
                                "nw",
                                "n",
                                "ne",
                                "e",
                                "se",
                                "s",
                                "sw",
                                "w",
                              ] as const
                            ).map((handle) => (
                              <button
                                key={handle}
                                className={`transform-handle resize-handle handle-${handle}`}
                                aria-label={`Resize image from ${handle}`}
                                onPointerDown={(event) =>
                                  beginTransform("resize", event, handle)
                                }
                              />
                            ))}
                            <button
                              className="transform-handle rotate-handle"
                              aria-label="Rotate image"
                              onPointerDown={(event) =>
                                beginTransform("rotate", event)
                              }
                            >
                              ↻
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <button
                        className="upload-empty"
                        onClick={() => imageInput.current?.click()}
                      >
                        <span>＋</span>
                        <strong>Select an image</strong>
                        <small>PNG or JPEG · 3000 × 4000 px and larger</small>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <aside className="settings">
                <div>
                  <p className="eyebrow">Project</p>
                  <label>
                    Name
                    <input
                      value={project.name}
                      onChange={(e) =>
                        setProject({ ...project, name: e.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="divider" />
                <div>
                  <p className="eyebrow">Canvas format</p>
                  <div className="dimensions">
                    <label>
                      Width
                      <span>
                        <input
                          type="number"
                          min="1"
                          value={project.canvas.widthMm}
                          onChange={(e) =>
                            patchCanvas("widthMm", Number(e.target.value))
                          }
                        />
                        mm
                      </span>
                    </label>
                    <label>
                      Height
                      <span>
                        <input
                          type="number"
                          min="1"
                          value={project.canvas.heightMm}
                          onChange={(e) =>
                            patchCanvas("heightMm", Number(e.target.value))
                          }
                        />
                        mm
                      </span>
                    </label>
                  </div>
                  <p className="hint">
                    {project.canvas.orientation === "portrait"
                      ? "Portrait"
                      : "Landscape"}{" "}
                    · ratio 1:
                    {(project.canvas.heightMm / project.canvas.widthMm).toFixed(
                      2,
                    )}
                  </p>
                </div>
                <div className="divider" />
                <button
                  className="secondary"
                  onClick={() => imageInput.current?.click()}
                >
                  {project.sourceImage
                    ? "Change source image"
                    : "Import source image"}
                </button>
                {project.sourceImage && imageSelected && (
                  <button
                    className="transform-reset"
                    onClick={() =>
                      setProject({
                        ...project,
                        sourceTransform: {
                          offsetXPercent: 0,
                          offsetYPercent: 0,
                          scaleX: 1,
                          scaleY: 1,
                          rotationDeg: 0,
                        },
                      })
                    }
                  >
                    Reset transform
                  </button>
                )}
                {project.sourceImage && (
                  <button className="flow-next" onClick={() => goToStep(1)}>
                    Continue to Palette →
                  </button>
                )}
                <div className="status">
                  <span />
                  {message}
                </div>
              </aside>
            </section>
          </>
        ) : activeStep === 1 ? (
          <>
            <section className="intro">
              <p className="eyebrow">Step 02 · Palette</p>
              <h1>Reduce the image to physical paints.</h1>
              <p>
                Every output pixel is matched to the nearest available paint in
                perceptual OKLab space.
              </p>
            </section>
            <section className="palette-workspace">
              <div className="comparison">
                <div>
                  <p>Original</p>
                  {project.sourceImage ? (
                    <canvas
                      ref={paletteSourceCanvas}
                      aria-label="Transformed source preview"
                    />
                  ) : (
                    <div className="empty-preview">
                      Import an image in Step 01
                    </div>
                  )}
                </div>
                <div>
                  <p>Posterized</p>
                  {project.sourceImage ? (
                    <canvas
                      ref={posterizedCanvas}
                      aria-label="Posterized preview"
                    />
                  ) : (
                    <div className="empty-preview">No preview available</div>
                  )}
                </div>
              </div>
              <aside className="palette-editor">
                <div className="palette-heading">
                  <div>
                    <p className="eyebrow">Physical paints</p>
                    <small>{project.palette.length} / 8 colors</small>
                  </div>
                  <button
                    disabled={project.palette.length >= 8}
                    onClick={addPaletteColor}
                  >
                    Add color
                  </button>
                </div>
                <div className="color-list">
                  {project.palette.map((color) => (
                    <div className="color-row" key={color.id}>
                      <input
                        aria-label={`${color.name} color`}
                        type="color"
                        value={color.hex}
                        onChange={(event) =>
                          patchPaletteColor(color.id, {
                            hex: event.target.value.toUpperCase() as `#${string}`,
                          })
                        }
                      />
                      <input
                        aria-label="Color name"
                        value={color.name}
                        onChange={(event) =>
                          patchPaletteColor(color.id, {
                            name: event.target.value,
                          })
                        }
                      />
                      <button
                        className={color.locked ? "locked-color" : ""}
                        onClick={() =>
                          patchPaletteColor(color.id, { locked: !color.locked })
                        }
                      >
                        {color.locked ? "Locked" : "Lock"}
                      </button>
                      <button
                        className={color.skipPainting ? "canvas-color" : ""}
                        title="Treat this color as unpainted canvas"
                        onClick={() =>
                          setProject((current) => ({
                            ...current,
                            palette: current.palette.map((entry) => ({
                              ...entry,
                              skipPainting:
                                entry.id === color.id
                                  ? !color.skipPainting
                                  : false,
                            })),
                          }))
                        }
                      >
                        {color.skipPainting ? "Canvas" : "Paint"}
                      </button>
                      <button
                        disabled={project.palette.length === 1}
                        onClick={() => removePaletteColor(color.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="poster-controls">
                  <label>
                    Detail
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={project.posterization.detail}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          posterization: {
                            ...project.posterization,
                            detail: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Edge smoothing
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={project.posterization.smoothing}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          posterization: {
                            ...project.posterization,
                            smoothing: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </div>
                <div className="flow-actions">
                  <button
                    className="flow-back"
                    onClick={() => setActiveStep(0)}
                  >
                    ← Back
                  </button>
                  <button className="flow-next" onClick={() => goToStep(2)}>
                    Continue to Strokes →
                  </button>
                </div>
              </aside>
            </section>
          </>
        ) : activeStep === 2 ? (
          <section className="stroke-step">
            <div className="intro">
              <p className="eyebrow">Step 03 · Strokes</p>
              <h1>Shape an organic brush language.</h1>
              <p>
                Set the physical brush and fill strategy. Stroke paths are
                clipped to individual color regions.
              </p>
            </div>
            <div className="stroke-settings-grid">
              <div className="stroke-preview">
                <div className="preview-toolbar">
                  <span>
                    {project.strokeSettings.style[0].toUpperCase() +
                      project.strokeSettings.style.slice(1)}{" "}
                    variation · {strokeCount} strokes
                  </span>
                  <div className="stroke-zoom-controls">
                    <label className="trajectory-toggle">
                      <input
                        type="checkbox"
                        checked={showTrajectories}
                        onChange={(event) =>
                          setShowTrajectories(event.target.checked)
                        }
                      />
                      <span>Trajectories</span>
                    </label>
                    <button
                      onClick={() => zoomStrokePreview(strokeZoom - 0.25)}
                    >
                      −
                    </button>
                    <input
                      aria-label="Stroke preview zoom"
                      type="range"
                      min="50"
                      max="400"
                      step="25"
                      value={strokeZoom * 100}
                      onChange={(event) =>
                        zoomStrokePreview(Number(event.target.value) / 100)
                      }
                    />
                    <span>{Math.round(strokeZoom * 100)}%</span>
                    <button
                      onClick={() => zoomStrokePreview(strokeZoom + 0.25)}
                    >
                      +
                    </button>
                    <button
                      onClick={() => {
                        setRenderedStrokeProject(project);
                        setGenerationRevision((value) => value + 1);
                      }}
                    >
                      Generate preview
                    </button>
                  </div>
                </div>
                {project.sourceImage ? (
                  <div
                    ref={strokeViewport}
                    className="stroke-viewport"
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      const viewport = event.currentTarget;
                      strokePan.current = {
                        x: event.clientX,
                        y: event.clientY,
                        scrollLeft: viewport.scrollLeft,
                        scrollTop: viewport.scrollTop,
                      };
                      viewport.setPointerCapture(event.pointerId);
                      viewport.classList.add("panning");
                    }}
                    onPointerMove={(event) => {
                      const pan = strokePan.current;
                      if (!pan) return;
                      event.currentTarget.scrollLeft =
                        pan.scrollLeft - (event.clientX - pan.x);
                      event.currentTarget.scrollTop =
                        pan.scrollTop - (event.clientY - pan.y);
                    }}
                    onPointerUp={(event) => {
                      strokePan.current = null;
                      event.currentTarget.classList.remove("panning");
                    }}
                    onPointerCancel={(event) => {
                      strokePan.current = null;
                      event.currentTarget.classList.remove("panning");
                    }}
                  >
                    <div
                      className="stroke-canvas-surface"
                      style={{
                        width: `${strokeFitSize.width * strokeZoom}px`,
                        height: `${strokeFitSize.height * strokeZoom}px`,
                      }}
                    >
                      <canvas
                        ref={strokeCanvas}
                        aria-label="Generated stroke preview"
                        style={{
                          width: `${strokeFitSize.width * strokeZoom}px`,
                          height: `${strokeFitSize.height * strokeZoom}px`,
                          maxWidth: "none",
                          maxHeight: "none",
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="empty-preview">
                    Import an image before generating strokes
                  </div>
                )}
                <p>
                  Spacing{" "}
                  {(
                    project.brush.widthMm *
                    (1 - project.strokeSettings.overlap)
                  ).toFixed(1)}{" "}
                  mm · {project.strokeSettings.seed || "random seed"}
                </p>
              </div>
              <aside className="settings">
                <div>
                  <p className="eyebrow">Brush profile</p>
                  <label>
                    Name
                    <input
                      value={project.brush.name}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          brush: { ...project.brush, name: event.target.value },
                        })
                      }
                    />
                  </label>
                  <label>
                    Shape
                    <select
                      value={project.brush.shape}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          brush: {
                            ...project.brush,
                            shape: event.target.value as "flat" | "round",
                          },
                        })
                      }
                    >
                      <option value="flat">Flat</option>
                      <option value="round">Round</option>
                    </select>
                  </label>
                  <label>
                    Width · {project.brush.widthMm.toFixed(1)} mm
                    <input
                      type="range"
                      min="1"
                      max="40"
                      step="0.1"
                      value={project.brush.widthMm}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          brush: {
                            ...project.brush,
                            widthMm: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </div>
                <div className="divider" />
                <div>
                  <p className="eyebrow">Fill strategy</p>
                  <label>
                    Painting style
                    <select
                      value={project.strokeSettings.style}
                      onChange={(event) => {
                        const preset =
                          strokeStylePresets[
                            event.target
                              .value as StrokeGenerationSettings["style"]
                          ];
                        setProject({
                          ...project,
                          brush: preset.brush,
                          strokeSettings: {
                            ...preset.settings,
                            seed: project.strokeSettings.seed,
                          },
                        });
                      }}
                    >
                      <option value="realism">Realism</option>
                      <option value="impressionism">Impressionism</option>
                      <option value="expressionism">Expressionism</option>
                      <option value="pointillism">Pointillism</option>
                      <option value="abstract">Abstract</option>
                    </select>
                  </label>
                  <label>
                    Variation seed
                    <span className="seed-input-row">
                      <input
                        value={project.strokeSettings.seed}
                        placeholder="Blank creates a new variant each time"
                        onChange={(event) =>
                          setProject({
                            ...project,
                            strokeSettings: {
                              ...project.strokeSettings,
                              seed: event.target.value,
                            },
                          })
                        }
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setProject({
                            ...project,
                            strokeSettings: {
                              ...project.strokeSettings,
                              seed: crypto.randomUUID().slice(0, 8),
                            },
                          })
                        }
                      >
                        New
                      </button>
                    </span>
                  </label>
                  <label>
                    Direction
                    <select
                      value={project.strokeSettings.direction}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          strokeSettings: {
                            ...project.strokeSettings,
                            direction: event.target
                              .value as StrokeGenerationSettings["direction"],
                          },
                        })
                      }
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                      <option value="random">Random</option>
                      <option value="flow">Region flow</option>
                    </select>
                  </label>
                  <label>
                    Stroke geometry
                    <select
                      value={project.strokeSettings.geometry}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          strokeSettings: {
                            ...project.strokeSettings,
                            geometry: event.target
                              .value as StrokeGenerationSettings["geometry"],
                          },
                        })
                      }
                    >
                      <option value="linear">Linear</option>
                      <option value="curved">Curved</option>
                      <option value="contour">Contour</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </label>
                  {project.strokeSettings.geometry !== "linear" &&
                    project.strokeSettings.geometry !== "contour" && (
                      <label>
                        Curvature ·{" "}
                        {Math.round(project.strokeSettings.curvature * 100)}%
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={project.strokeSettings.curvature * 100}
                          onChange={(event) =>
                            setProject({
                              ...project,
                              strokeSettings: {
                                ...project.strokeSettings,
                                curvature: Number(event.target.value) / 100,
                              },
                            })
                          }
                        />
                      </label>
                    )}
                  <label>
                    Overlap · {Math.round(project.strokeSettings.overlap * 100)}
                    %
                    <input
                      type="range"
                      min="0"
                      max="80"
                      value={project.strokeSettings.overlap * 100}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          strokeSettings: {
                            ...project.strokeSettings,
                            overlap: Number(event.target.value) / 100,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Speed · {project.strokeSettings.speedMmPerMin} mm/min
                    <input
                      type="range"
                      min="100"
                      max="2000"
                      step="50"
                      value={project.strokeSettings.speedMmPerMin}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          strokeSettings: {
                            ...project.strokeSettings,
                            speedMmPerMin: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Pressure ·{" "}
                    {Math.round(project.strokeSettings.pressure * 100)}%
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={project.strokeSettings.pressure * 100}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          strokeSettings: {
                            ...project.strokeSettings,
                            pressure: Number(event.target.value) / 100,
                          },
                        })
                      }
                    />
                  </label>
                  <div className="stroke-length-range">
                    <p>Adaptive stroke length</p>
                    <label>
                      Min ·{" "}
                      {Math.round(
                        project.strokeSettings.minStrokeLengthMm ?? 12,
                      )}{" "}
                      mm
                      <input
                        type="range"
                        min="1"
                        max="200"
                        step="1"
                        value={project.strokeSettings.minStrokeLengthMm ?? 12}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setProject({
                            ...project,
                            strokeSettings: {
                              ...project.strokeSettings,
                              minStrokeLengthMm: value,
                              maxStrokeLengthMm: Math.max(
                                value,
                                project.strokeSettings.maxStrokeLengthMm ?? 75,
                              ),
                            },
                          });
                        }}
                      />
                    </label>
                    <label>
                      Max ·{" "}
                      {Math.round(
                        project.strokeSettings.maxStrokeLengthMm ?? 75,
                      )}{" "}
                      mm
                      <input
                        type="range"
                        min="1"
                        max="300"
                        step="1"
                        value={project.strokeSettings.maxStrokeLengthMm ?? 75}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          setProject({
                            ...project,
                            strokeSettings: {
                              ...project.strokeSettings,
                              minStrokeLengthMm: Math.min(
                                value,
                                project.strokeSettings.minStrokeLengthMm ?? 12,
                              ),
                              maxStrokeLengthMm: value,
                            },
                          });
                        }}
                      />
                    </label>
                  </div>
                  <label>
                    Paint load length ·{" "}
                    {project.strokeSettings.paintLoadLengthMm ?? 120} mm
                    <input
                      type="range"
                      min="10"
                      max="500"
                      step="10"
                      value={project.strokeSettings.paintLoadLengthMm ?? 120}
                      onChange={(event) =>
                        setProject({
                          ...project,
                          strokeSettings: {
                            ...project.strokeSettings,
                            paintLoadLengthMm: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </aside>
            </div>
            <div className="flow-actions">
              <button className="flow-back" onClick={() => setActiveStep(1)}>
                ← Back
              </button>
              <button className="flow-next" onClick={() => goToStep(3)}>
                Continue to Workspace →
              </button>
            </div>
          </section>
        ) : (
          <section className="planned-step">
            <p className="eyebrow">
              Step {String(activeStep + 1).padStart(2, "0")} ·{" "}
              {steps[activeStep]}
            </p>
            <h1>{plannedSteps[activeStep - 2].title}</h1>
            <p>{plannedSteps[activeStep - 2].description}</p>
            <div className="planned-card">
              <span>Coming in the next implementation phase</span>
              <strong>
                Your project data is preserved while this tool is being built.
              </strong>
            </div>
            <div className="flow-actions">
              <button
                className="flow-back"
                onClick={() => setActiveStep(activeStep - 1)}
              >
                ← Back
              </button>
              {activeStep < steps.length - 1 && (
                <button
                  className="flow-next"
                  onClick={() => goToStep(activeStep + 1)}
                >
                  Continue →
                </button>
              )}
            </div>
          </section>
        )}
        {activeStep === 1 && (
          <section className="restriction-panel">
            <div>
              <p className="eyebrow">Accent color protection</p>
              <p>
                Restrict accent paints so they are only used on source pixels
                with a similar hue and enough chroma.
              </p>
            </div>
            <div className="restriction-colors">
              {project.palette.map((color) => (
                <button
                  key={color.id}
                  className={color.restricted ? "restricted-color" : ""}
                  onClick={() =>
                    patchPaletteColor(color.id, {
                      restricted: !color.restricted,
                    })
                  }
                >
                  <span style={{ background: color.hex }} />
                  {color.name}
                  <small>
                    {color.restricted
                      ? `${color.hueToleranceDeg}° tolerance`
                      : "Global"}
                  </small>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg"
        onChange={importImage}
      />
      <input
        hidden
        ref={projectInput}
        type="file"
        accept="application/json,.json"
        onChange={open}
      />
    </div>
  );
}
