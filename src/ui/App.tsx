import {runCalculation,calculationProject} from "../platform/runCalculation.ts";
import {CalculationProgress} from "./CalculationProgress.tsx";
import { AiPosterizationControls } from "./AiPosterizationControls.tsx";
import { analyzeWithSam3 } from "../platform/sam3.ts";
import { AI_POSTERIZATION_VERSION, defaultAiPosterizationSettings, prepareAiPosterization, type AiImportanceMask } from "../core/aiPosterization.ts";
import { StrokeAnalytics } from "./StrokeAnalytics.tsx";
import type { MachinePlanSnapshot } from "../core/machineProgram.ts";
import { MachineExport } from "./MachineExport.tsx";
import { StrokeTemplatePanel } from "./StrokeTemplatePanel.tsx";
import { FocusMaskEditor } from "./FocusMaskEditor.tsx";
import { medianFilterPixels } from "../core/medianFilter.ts";
import { strategySchemas } from "../core/strategySchema.ts";
import { facePalette } from "../core/facePalette.ts";
import { imagePalette } from "../core/imagePalette.ts";
import { defaultImagePaletteSize, maxPaletteColors } from "../core/paletteLimits.ts";
import { priorityDefaults } from "../core/priority.ts";
import { Simulation } from "./Simulation.tsx";
import type { PaintingPlan } from "../core/model.ts";
import { createProjectWithDefaultLayout } from "../project/workspaceProfiles.ts";
import { WorkspaceEditor } from "./WorkspaceEditor.tsx";
import { ColorPicker } from "./ColorPicker.tsx";
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
import { posterizePixels } from "../core/color.ts";
import {
  type ColorRegionMap,
} from "../core/strokes.ts";

const steps = [
  "Image",
  "Palette",
  "Strokes",
  "Workspace",
  "Simulation",
  "Export",
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

async function sampleImageColors(source: SourceImage): Promise<Uint8ClampedArray> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve(); image.onerror = () => reject(new Error("Image colours could not be analysed.")); image.src = source.dataUrl;
  });
  const scale = Math.min(1, 160 / Math.max(source.widthPx, source.heightPx));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.widthPx * scale)); canvas.height = Math.max(1, Math.round(source.heightPx * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Image analysis is unavailable.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
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

function strokeSignature(project: CaravaiggioProject): string {
  const { paintLoadLengthMm, paintSimulation, templateId, ...geometrySettings } = project.strokeSettings;
  return JSON.stringify([project.id, project.sourceImage, project.sourceTransform, project.canvas, project.palette, project.brush, geometrySettings, project.posterization.medianRadiusMm, project.posterization.method ?? "classic", project.posterization.method === "sam3" ? [AI_POSTERIZATION_VERSION, project.posterization.ai ?? defaultAiPosterizationSettings] : null]);
}
export function App() {
  const [generatedPlan, setGeneratedPlan] = useState<{ plan: PaintingPlan; signature: string; regionMap: ColorRegionMap } | null>(null);
  const [machinePaths, setMachinePaths] = useState<MachinePlanSnapshot | null>(null);
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const initialProject = useRef(createProjectWithDefaultLayout());
  const [project, setProject] = useState<CaravaiggioProject>(
    initialProject.current,
  );
  const [renderedStrokeProject, setRenderedStrokeProject] =
    useState<CaravaiggioProject>(initialProject.current);
  const [aiResult,setAiResult]=useState<{key:string;status:"loading"|"ready"|"error";mask?:AiImportanceMask;error?:string}|null>(null);
  const [aiRetry,setAiRetry]=useState(0);
  const [palettePreviewProject,setPalettePreviewProject]=useState<CaravaiggioProject|null>(null);
  const aiCache=useRef(new Map<string,AiImportanceMask>());
  const [cleanSnapshot, setCleanSnapshot] = useState(() =>
    JSON.stringify(initialProject.current),
  );
  const [message, setMessage] = useState("Project is ready");
  const [activeStep, setActiveStep] = useState(0);
  const aiProject=activeStep===2 ? renderedStrokeProject : project;
  const aiKey=useMemo(()=>JSON.stringify([AI_POSTERIZATION_VERSION,aiProject.sourceImage?.dataUrl,aiProject.sourceTransform,aiProject.canvas.widthMm,aiProject.canvas.heightMm]),[aiProject.sourceImage,aiProject.sourceTransform,aiProject.canvas.widthMm,aiProject.canvas.heightMm]);
  const aiMask=aiResult?.key===aiKey && aiResult.status==="ready" ? aiResult.mask : undefined;
  const aiMode=(aiProject.posterization.method??"classic")==="sam3";

  const [highestUnlockedStep, setHighestUnlockedStep] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const paletteSourceCanvas = useRef<HTMLCanvasElement>(null);
  const posterizedCanvas = useRef<HTMLCanvasElement>(null);
  const strokeCanvas = useRef<HTMLCanvasElement>(null);
  const strokePreviewCache = useRef<{ plan: PaintingPlan; project: CaravaiggioProject; painting?: HTMLCanvasElement; trajectories?: HTMLCanvasElement } | null>(null);
  const strokeViewport = useRef<HTMLDivElement>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [strokePreviewError, setStrokePreviewError] = useState("");
  const [generationRevision, setGenerationRevision] = useState(0);
  const [generationProgress,setGenerationProgress]=useState<string|null>(null);
  const [previewProgress,setPreviewProgress]=useState<string|null>(null);
  const strokeProgress=generationProgress??previewProgress;
  const previewSeed = useRef(crypto.randomUUID());
  const generatedPreview = useRef<{ project: CaravaiggioProject; revision: number } | null>(null);
  const [strokeZoom, setStrokeZoom] = useState(1);
  const [showTrajectories, setShowTrajectories] = useState(false);
  const [showImportance, setShowImportance] = useState(false);
  const [editingFocus, setEditingFocus] = useState(false);
  const [focusRadius, setFocusRadius] = useState(.09);
  const [eraseFocus, setEraseFocus] = useState(false);
  const focusEditorActive = editingFocus && project.strokeSettings.strategy === "flow-curves" && !!project.strokeSettings.priority?.enabled;
  const priorityPreview = useRef<{ width: number; height: number; values: Float32Array } | null>(null);
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

  useEffect(()=>{
    if(!aiMode || !aiProject.sourceImage || (activeStep!==1 && activeStep!==2))return;
    const cached=aiCache.current.get(aiKey);
    if(cached){setAiResult({key:aiKey,status:"ready",mask:cached});return;}
    const controller=new AbortController();
    const image=new Image();
    setAiResult({key:aiKey,status:"loading"});
    image.onload=()=>{
      const aspect=aiProject.canvas.widthMm/aiProject.canvas.heightMm;
      const width=aspect>=1?900:Math.max(1,Math.round(900*aspect)),height=aspect>=1?Math.max(1,Math.round(900/aspect)):900;
      const surface=document.createElement("canvas");surface.width=width;surface.height=height;
      const context=surface.getContext("2d",{willReadFrequently:true});
      if(!context){setAiResult({key:aiKey,status:"error",error:"Image analysis is unavailable."});return;}
      drawTransformedImage(context,image,width,height,aiProject.sourceTransform);
      void analyzeWithSam3(context.getImageData(0,0,width,height).data,width,height,controller.signal).then(mask=>{
        if(controller.signal.aborted)return;
        if(aiCache.current.size>=3)aiCache.current.delete(aiCache.current.keys().next().value!);
        aiCache.current.set(aiKey,mask);setAiResult({key:aiKey,status:"ready",mask});
      }).catch(error=>{if(!controller.signal.aborted)setAiResult({key:aiKey,status:"error",error:error instanceof Error?error.message:"SAM 3 analysis failed."});});
    };
    image.onerror=()=>setAiResult({key:aiKey,status:"error",error:"Could not load the image for AI analysis."});
    const timer=setTimeout(()=>{image.src=aiProject.sourceImage!.dataUrl;},300);
    return ()=>{clearTimeout(timer);controller.abort();image.onload=null;image.onerror=null;};
  },[activeStep,aiMode,aiKey,aiRetry]);

  useEffect(() => {
    const canvas = posterizedCanvas.current;
    const sourceCanvas = paletteSourceCanvas.current;
    if (activeStep !== 1 || !canvas || !sourceCanvas || !project.sourceImage)
      return;
    const image = new Image();
    image.onload = () => {
      const detailScale = project.posterization.method === "sam3" ? 1 : 0.2 + project.posterization.detail / 125;
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
      context.filter = project.posterization.method !== "sam3" && project.posterization.smoothing
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
      if(project.posterization.method==="sam3" && !aiMask){context.clearRect(0,0,width,height);return;}
      const shadeCount=project.posterization.method === "sam3" ? project.posterization.ai?.faceShadeCount ?? 0 : 0;
      const palette=facePalette(imageData.data,width,height,aiMask,project.palette,shadeCount);
      if(JSON.stringify(palette)!==JSON.stringify(project.palette)) {
        setProject(current=>current.palette===project.palette && current.posterization===project.posterization && current.sourceImage===project.sourceImage && current.sourceTransform===project.sourceTransform && current.canvas===project.canvas ? {...current,palette} : current);
        return;
      }
      const prepared=project.posterization.method==="sam3" ? prepareAiPosterization(imageData.data,width,height,project.canvas,aiMask!,project.posterization.ai??defaultAiPosterizationSettings) : medianFilterPixels(imageData.data, width, height, project.canvas, project.posterization.medianRadiusMm);
      imageData.data.set(posterizePixels(prepared, project.palette));
      context.putImageData(imageData, 0, 0);
      setPalettePreviewProject(project);
    };
    image.src = project.sourceImage.dataUrl;
    return () => { image.onload = null; image.onerror = null; };
  }, [
    activeStep,
    aspect,
    project.palette,
    project.posterization,
    project.canvas,
    project.sourceImage,
    project.sourceTransform,
    aiMask,
  ]);

  useEffect(() => {
    const canvas = strokeCanvas.current;
    const sourceImage = renderedStrokeProject.sourceImage;
    if (activeStep !== 2 || !canvas || !sourceImage) {setGenerationProgress(null);return;}
    if (generatedPreview.current?.project === renderedStrokeProject &&
        generatedPreview.current.revision === generationRevision && generatedPlan?.regionMap) return;
    if(renderedStrokeProject.posterization.method==="sam3" && !aiMask){setGenerationProgress(null);setStrokePreviewError(aiResult?.status==="error"?aiResult.error??"AI analysis failed.":"Waiting for local SAM 3 analysis.");return;}
    const controller=new AbortController();
    setGenerationProgress("Loading the source image…");
    const previewProject = renderedStrokeProject;
    const previewAspect =
      previewProject.canvas.widthMm / previewProject.canvas.heightMm;
    const image = new Image();
    image.onload = async () => {
      try {
      const resolution=previewProject.posterization.method==="sam3" ? 480 : 240;
      const width = previewAspect >= 1 ? resolution : Math.max(1,Math.round(resolution*previewAspect));
      const height = previewAspect >= 1 ? Math.max(1,Math.round(resolution/previewAspect)) : resolution;
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = width;
      sourceCanvas.height = height;
      const sourceContext = sourceCanvas.getContext("2d", {
        willReadFrequently: true,
      });
      if (!sourceContext) throw Error("Image processing is unavailable.");
      drawTransformedImage(
        sourceContext,
        image,
        width,
        height,
        previewProject.sourceTransform,
      );
      const pixels = sourceContext.getImageData(0, 0, width, height).data;
      const result=await runCalculation<"strokes">({kind:"strokes",project:calculationProject(previewProject),pixels,width,height,mask:aiMask,seed:previewSeed.current},setGenerationProgress,controller.signal);
      if(controller.signal.aborted)return;
      priorityPreview.current={width,height,values:result.priority};
      generatedPreview.current={project:previewProject,revision:generationRevision};
      setPreviewProgress("Preparing the stroke preview…");
      setGenerationProgress(null);
      setGeneratedPlan({plan:result.plan,signature:strokeSignature(previewProject),regionMap:result.regionMap});
      setStrokePreviewError("");
      } catch (error) {
        if(controller.signal.aborted)return;
        setGenerationProgress(null);
        setStrokePreviewError(error instanceof Error ? error.message : "Could not generate the stroke preview.");
      }
    };
    image.onerror = () => {setGenerationProgress(null);setStrokePreviewError("Could not load the source image for the stroke preview.");};
    image.src = sourceImage.dataUrl;
    return () => { controller.abort();image.onload = null; image.onerror = null; };
  }, [activeStep, generationRevision, renderedStrokeProject, aiMask, aiResult?.status, aiResult?.error]);

  useEffect(() => {
    const canvas = strokeCanvas.current;
    if(activeStep!==2){setPreviewProgress(null);return;}
    if (!canvas || !generatedPlan ||
        generatedPlan.signature !== strokeSignature(renderedStrokeProject)) return;
    const previewProject = renderedStrokeProject;
    const previewPalette = previewProject.palette;
    const previewAspect = previewProject.canvas.widthMm / previewProject.canvas.heightMm;
    const plan = generatedPlan.plan;
    setStrokeCount(plan.operations.filter(op => op.type === "stroke").length);
    if (showImportance && priorityPreview.current) {
      setPreviewProgress(null);
      const { width, height, values } = priorityPreview.current;
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < values.length; i++) { const v = values[i]; rgba.set([25 + v * 230, 25 + v * 135, 30 * (1 - v), 255], i * 4); }
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d")?.putImageData(new ImageData(rgba, width, height), 0, 0);
      const frame = requestAnimationFrame(fitStrokePreview); return () => cancelAnimationFrame(frame);
    }
    const controller=new AbortController();
    void (async()=>{
    setPreviewProgress("Rendering the stroke preview…");
    try {
    let cache = strokePreviewCache.current;
    if (!cache || cache.plan !== plan || cache.project !== previewProject) {
      cache = { plan, project: previewProject };
      strokePreviewCache.current = cache;
    }
    const key = showTrajectories ? "trajectories" : "painting";
    if (!cache[key]) {
      const renderPreview = async (showTrajectories: boolean) => {
      const canvas = document.createElement("canvas");
      const previewWidth = 760;
      canvas.width = previewWidth;
      canvas.height = Math.max(1, Math.round(previewWidth / previewAspect));
      const context = canvas.getContext("2d");
      if (!context) return canvas;
      if (!showTrajectories) {
        const raster=await runCalculation<"preview">({kind:"preview",plan,project:calculationProject(previewProject)},setPreviewProgress,controller.signal);
        if(controller.signal.aborted)return canvas;
        const rasterWidth=raster.width,rasterHeight=raster.height;
        const layer = document.createElement("canvas"); layer.width = rasterWidth; layer.height = rasterHeight;
        layer.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(raster.rgba), rasterWidth, rasterHeight), 0, 0);
        context.drawImage(layer, 0, 0, canvas.width, canvas.height);
        return canvas;
      }
      context.fillStyle = "#11110f";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 1;
      context.strokeStyle = "#E6D39B";
      for (const operation of plan.operations) if (operation.type === "stroke") {
        context.beginPath();
        operation.points.forEach((point, index) => {
          const x = point.x / previewProject.canvas.widthMm * canvas.width;
          const y = point.y / previewProject.canvas.heightMm * canvas.height;
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.stroke();
      }
      return canvas;
      };
      const preview=await renderPreview(showTrajectories);
      if(controller.signal.aborted)return;
      cache[key]=preview;
    }
    const preview = cache[key]!;
    canvas.width = preview.width;
    canvas.height = preview.height;
    canvas.getContext("2d")?.drawImage(preview, 0, 0);
      setStrokePreviewError("");
      setStrokeCount(
        plan.operations.filter((operation) => operation.type === "stroke")
          .length,
      );
      setPreviewProgress(null);
      requestAnimationFrame(()=>{if(!controller.signal.aborted)fitStrokePreview();});
    } catch (error) {
      if(controller.signal.aborted)return;
      setPreviewProgress(null);
      setStrokePreviewError(error instanceof Error ? error.message : "Could not render the stroke preview.");
    }
    })();
    return ()=>controller.abort();
  }, [activeStep, generatedPlan, renderedStrokeProject, showTrajectories, showImportance]);

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
        color.id === id ? { ...color, ...patch, ...(color.autoFaceShade && patch.hex ? {locked:true} : {}) } : color,
      ),
    }));
  const removePaletteColor = (id: string) =>
    setProject((current) =>
      current.palette.length === 1
        ? current
        : {
            ...current,
            palette: current.palette.filter((color) => color.id !== id),
            ...(current.palette.find(color=>color.id===id)?.autoFaceShade && current.posterization.ai ? {posterization:{...current.posterization,ai:{...current.posterization.ai,faceShadeCount:Math.max(0,(current.posterization.ai.faceShadeCount??0)-1)}}} : {}),
          },
    );
  const addPaletteColor = () =>
    setProject((current) =>
      current.palette.length >= maxPaletteColors
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
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type))
      return setMessage("Select a PNG, JPEG or WebP image.");
    try {
      const sourceImage = await readImage(file);
      const photoPixels = await sampleImageColors(sourceImage);
      setProject((current) => {
        const locked = current.palette.filter(color => color.locked);
        const suggested = imagePalette(photoPixels, defaultImagePaletteSize, locked.map(color => color.hex));
        const slots = current.palette.filter(color => !color.locked);
        const palette = [...locked, ...suggested.map((hex, index) => ({
          id: slots[index]?.id ?? crypto.randomUUID(), name: `Image colour ${index + 1}`, hex,
          locked: false, skipPainting: false, restricted: false, hueToleranceDeg: 30, minimumChroma: 0.04,
        }))];
        return {
        ...current,
        palette: palette.length ? palette : current.palette,
        sourceImage,
        sourceTransform: {
          offsetXPercent: 0,
          offsetYPercent: 0,
          scaleX: 1,
          scaleY: 1,
          rotationDeg: 0,
        },
      };
      });
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

  const strokePreviewStatus = `${project.strokeSettings.strategy && project.strokeSettings.strategy !== "legacy" ? strategySchemas[project.strokeSettings.strategy].name : project.strokeSettings.style[0].toUpperCase() + project.strokeSettings.style.slice(1)} variation · ${strokeCount} strokes`
    + (generatedPlan?.plan.coverageStats?.strokes ? ` · ${generatedPlan.plan.coverageStats.strokes} gap fill strokes` : "")
    + (generatedPlan?.plan.recognitionStats?.strokes ? ` · ${generatedPlan.plan.recognitionStats.strokes} recognition detail strokes` : "")
    + (generatedPlan?.plan.shadowStats ? ` · ${generatedPlan.plan.shadowStats.strokes} shadow strokes` : "")
    + (generatedPlan?.plan.generationStats?.omittedShortStrokes ? ` · ${generatedPlan.plan.generationStats.omittedShortStrokes} strokes below Min omitted` : "")
    + (strokeSignature(project) !== strokeSignature(renderedStrokeProject) ? " · Settings changed — Regenerate" : "");

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
              if (await replaceProject(() => createProjectWithDefaultLayout()))
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
                        <small>PNG, JPEG or WebP · 3000 × 4000 px and larger</small>
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
                    <small>Active colors: {project.palette.length}</small>
                  </div>
                  <button
                    disabled={project.palette.length >= maxPaletteColors}
                    onClick={addPaletteColor}
                  >
                    Add color
                  </button>
                </div>
                <div className="color-list">
                  {project.palette.map((color) => (
                    <div className="color-row" key={color.id}>
                      <button type="button" className="color-swatch-button"
                        aria-label={`Choose ${color.name} colour`}
                        style={{ background: color.hex }} onClick={() => setEditingColorId(color.id)} />
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
                  <AiPosterizationControls settings={project.posterization}
                    onChange={settings=>setProject(previous=>({...previous,posterization:settings}))}
                    analysis={aiResult?.key===aiKey ? {status:aiResult.status,subjects:aiResult.mask?.subjects,details:aiResult.mask?.details,faces:aiResult.mask?.faces,recognitionDetails:aiResult.mask?.recognitionDetails,hairDetails:aiResult.mask?.hairDetails,accessoryDetails:aiResult.mask?.accessoryDetails,error:aiResult.error} : {status:"loading"}}
                    onRetry={()=>{aiCache.current.delete(aiKey);setAiRetry(value=>value+1);}} />
                  {project.posterization.method!=="sam3" && <>
                  <label className="trajectory-toggle"><input type="checkbox" checked={project.posterization.medianRadiusMm > 0}
                    onChange={e => setProject(previous => ({ ...previous, posterization: { ...previous.posterization, medianRadiusMm: e.target.checked ? 2 : 0 } }))} /><span>Remove colour speckles · median filter</span></label>
                  {project.posterization.medianRadiusMm > 0 && <label>Median radius · {project.posterization.medianRadiusMm} mm
                    <input type="range" min=".5" max="8" step=".5" value={project.posterization.medianRadiusMm} onChange={e => setProject(previous => ({ ...previous, posterization: { ...previous.posterization, medianRadiusMm: Number(e.target.value) } }))} />
                    <span className="workspace-caption">Merges tiny colour spots before palette mapping and stroke generation. Start at 2 mm; larger values remove fine features. Regenerate strokes after changes.</span>
                  </label>}

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
                  </>}
                </div>
                <div className="flow-actions">
                  <button
                    className="flow-back"
                    onClick={() => setActiveStep(0)}
                  >
                    ← Back
                  </button>
                  <button className="flow-next" disabled={project.posterization.method==="sam3" && (!aiMask || palettePreviewProject?.palette!==project.palette || palettePreviewProject?.posterization!==project.posterization || palettePreviewProject?.sourceImage!==project.sourceImage || palettePreviewProject?.sourceTransform!==project.sourceTransform || palettePreviewProject?.canvas!==project.canvas)} onClick={() => goToStep(2)}>
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
                  {strokePreviewError && <p role="alert">Preview failed: {strokePreviewError}</p>}
                <div className="preview-toolbar">
                  <span className="stroke-preview-status" title={strokePreviewStatus}>{strokePreviewStatus}</span>
                  <div className="stroke-zoom-controls">
                    <label className="trajectory-toggle">
                      <input
                        type="checkbox"
                        checked={showTrajectories}
                        onChange={(event) => {
                          setShowTrajectories(event.target.checked);
                          setShowImportance(false);
                        }}
                      />
                      <span>Trajectories</span>
                    </label>
                    <label className="trajectory-toggle">
                      <input type="checkbox" checked={showImportance} disabled={!showImportance && (!renderedStrokeProject.strokeSettings.priority?.enabled || renderedStrokeProject.strokeSettings.strategy !== "flow-curves")}
                        onChange={e => { setShowImportance(e.target.checked); setShowTrajectories(false); }} />
                      <span>Importance map</span>
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
                      type="button"
                      className="template-action template-action-primary preview-header-action"
                      disabled={!!strokeProgress}
                      onClick={() => {
                        previewSeed.current = crypto.randomUUID();
                        setRenderedStrokeProject(project);
                        setGenerationRevision((value) => value + 1);
                      }}
                    >
                      Regenerate
                    </button>
                  </div>
                </div>
                <CalculationProgress stage={strokeProgress} label="Stroke generation and preview"/>
                {focusEditorActive && <div className="focus-editor-toolbar">
                  <span>Paint focus · drag over the subject</span>
                  <label>Brush size · {Math.round(focusRadius * 200)}%<input aria-label="Focus brush size" type="range" min=".02" max=".3" step=".01" value={focusRadius} onChange={e => setFocusRadius(Number(e.target.value))} /></label>
                  <button type="button" className="template-action" aria-pressed={eraseFocus} onClick={() => setEraseFocus(value => !value)}>{eraseFocus ? "Eraser active" : "Erase"}</button>
                  <button type="button" className="template-action" onClick={() => setProject(previous => ({ ...previous, strokeSettings: { ...previous.strokeSettings, priority: { ...(previous.strokeSettings.priority ?? priorityDefaults), focus: false, mask: undefined } } }))}>Clear focus</button>
                  <button type="button" className="template-action" onClick={() => setEditingFocus(false)}>Done</button>
                </div>}
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
                      <div className="stroke-image-layer" style={{ width: strokeFitSize.width * strokeZoom, height: strokeFitSize.height * strokeZoom }}>
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
                      {focusEditorActive && <FocusMaskEditor settings={project.strokeSettings.priority ?? priorityDefaults} aspect={aspect} radius={focusRadius} erase={eraseFocus}
                        onChange={priority => setProject(previous => ({ ...previous, strokeSettings: { ...previous.strokeSettings, priority } }))} />}
                      </div>
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
                  {!!generatedPlan?.plan.shadowStats?.noDarkerPaintSeeds && " · Some shadows need a suitable darker paint in the palette"}
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
                <StrokeTemplatePanel project={project} onChange={setProject} editingFocus={focusEditorActive} onEditFocus={() => { setEditingFocus(value => !value); setShowImportance(false); setShowTrajectories(false); }} />
              </aside>
            </div>
{generatedPlan && generatedPlan.signature === strokeSignature(renderedStrokeProject) && <StrokeAnalytics plan={generatedPlan.plan} palette={renderedStrokeProject.palette} brushWidth={renderedStrokeProject.brush.widthMm} stale={generatedPlan.signature !== strokeSignature(project)} />}
            <div className="flow-actions">
              <button className="flow-back" onClick={() => setActiveStep(1)}>
                ← Back
              </button>
              <button className="flow-next" disabled={!!strokeProgress || (project.posterization.method==="sam3" && (Boolean(strokePreviewError) || generatedPlan?.signature!==strokeSignature(project)))} onClick={() => goToStep(3)}>
                Continue to Workspace →
              </button>
            </div>
          </section>
        ) : activeStep === 3 ? (
          <WorkspaceEditor project={project}
            onChange={workspace => setProject(current => ({ ...current, workspace }))}
            onBack={() => setActiveStep(2)} onNext={() => goToStep(4)} />
        ) : activeStep === 4 ? (
          <Simulation project={project} regionMap={generatedPlan?.regionMap} onPathsCalculated={setMachinePaths} onWorkspaceChange={workspace => setProject(current => ({ ...current, workspace }))} onPaintSimulationChange={paintSimulation => setProject(current => ({ ...current, strokeSettings: { ...current.strokeSettings, paintSimulation } }))} onCapacityChange={paintLoadLengthMm => setProject(current => ({ ...current, strokeSettings: { ...current.strokeSettings, paintLoadLengthMm } }))}
            plan={generatedPlan?.signature === strokeSignature(project) ? generatedPlan.plan : null}
            onBack={() => setActiveStep(3)} onRegenerate={() => goToStep(2)} onNext={() => goToStep(5)} />
        ) : (
          <MachineExport project={project} machinePaths={machinePaths} onRecalculate={() => goToStep(4)} plan={generatedPlan?.signature === strokeSignature(project) ? generatedPlan.plan : null}
            onBack={() => setActiveStep(4)} onWorkspace={() => goToStep(3)} onRegenerate={() => goToStep(2)} />
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
      {editingColorId && (() => {
        const color = project.palette.find(entry => entry.id === editingColorId);
        return color ? <ColorPicker key={color.id} name={color.name} hex={color.hex}
          image={project.sourceImage?.dataUrl} sourceCanvas={paletteSourceCanvas}
          onChange={hex => patchPaletteColor(color.id, { hex })}
          onClose={() => setEditingColorId(null)} /> : null;
      })()}
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
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
