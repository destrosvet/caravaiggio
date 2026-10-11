import type {CaravaiggioProject} from "../project/model.ts";
import type {CalculationRequest,CalculationResults,CalculationProject} from "./calculations.ts";
export function calculationProject({id,canvas,brush,palette,posterization,strokeSettings,workspace}:CaravaiggioProject):CalculationProject {
 return {id,canvas,brush,palette,posterization,strokeSettings,workspace};
}
export function runCalculation<K extends CalculationRequest["kind"]>(request:Extract<CalculationRequest,{kind:K}>,progress:(stage:string)=>void,signal:AbortSignal):Promise<CalculationResults[K]> {
 if(signal.aborted)return Promise.reject(new DOMException("Calculation cancelled.","AbortError"));
 if(typeof Worker==="undefined")return new Promise((resolve,reject)=>{
  // Compatibility fallback also yields once so loading UI can appear.
  setTimeout(()=>{void import("./calculations.ts").then(({executeCalculation})=>{
   if(signal.aborted)throw new DOMException("Calculation cancelled.","AbortError");
   const result=executeCalculation(request,progress) as CalculationResults[K];
   if(signal.aborted)throw new DOMException("Calculation cancelled.","AbortError");
   resolve(result);
  }).catch(reject);},0);
 });
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL("./calculationWorker.ts",import.meta.url),{type:"module"});
  const cleanup=()=>{worker.terminate();signal.removeEventListener("abort",abort);};
  const abort=()=>{cleanup();reject(new DOMException("Calculation cancelled.","AbortError"));};
  signal.addEventListener("abort",abort,{once:true});
  worker.onmessage=event=>{
   if(signal.aborted)return;
   if(event.data.type==="progress"){progress(event.data.stage);return;}
   cleanup();if(event.data.type==="error")reject(Error(event.data.error));else resolve(event.data.result as CalculationResults[K]);
  };
  worker.onerror=()=>{cleanup();reject(Error("Calculation worker failed. Please retry."));};
  try{worker.postMessage(request);}catch(error){cleanup();reject(error);}
 });
}
