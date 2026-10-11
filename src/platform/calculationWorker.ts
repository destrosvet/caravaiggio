import {executeCalculation,type CalculationRequest} from "./calculations.ts";
self.onmessage=(event:MessageEvent<CalculationRequest>)=>{
 try{const result=executeCalculation(event.data,stage=>self.postMessage({type:"progress",stage}));self.postMessage({type:"result",result});}
 catch(error){self.postMessage({type:"error",error:error instanceof Error?error.message:"Calculation failed."});}
};
