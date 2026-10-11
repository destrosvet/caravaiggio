import {useId} from "react";
export function CalculationProgress({stage,label}:{stage:string|null;label:string}){
 const id=useId();
 if(!stage)return null;
 return <div className="calculation-progress" aria-live="polite"><label htmlFor={id}>{stage}</label><progress id={id} aria-label={label}/></div>;
}
