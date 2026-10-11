import { useMemo, useState } from "react";
import { analyzeStrokes, strokeLengthLabels } from "../core/strokeAnalytics.ts";
import type { PaintingPlan } from "../core/model.ts";
import type { PaletteColor } from "../project/model.ts";
type Props={plan:PaintingPlan;palette:readonly PaletteColor[];brushWidth:number;stale:boolean};
export function StrokeAnalytics({plan,palette,brushWidth,stale}:Props) {
  const data=useMemo(()=>analyzeStrokes(plan,brushWidth),[plan,brushWidth]);
  const [metric,setMetric]=useState<"distance"|"count">("distance"),[focus,setFocus]=useState<string|null>(null);
  const active=data.rows.some(row=>row.paintId===focus)?focus:null;
  const paints=new Map(palette.map(p=>[p.id,p]));
  const name=(id:string)=>paints.get(id)?.name??id,colour=(id:string)=>paints.get(id)?.hex??"#888";
  const shareTotal=metric==="distance"?data.totalDistanceMm:data.count;
  const share=(row:typeof data.rows[number])=>shareTotal?(metric==="distance"?row.distanceMm:row.count)/shareTotal:0;
  const histogramRows=active?data.rows.filter(row=>row.paintId===active):data.rows;
  const bins=strokeLengthLabels.map((_,i)=>histogramRows.reduce((sum,row)=>sum+row.bins[i],0));
  const max=Math.max(1,...bins),circumference=2*Math.PI*60;
  let offset=0;
  return <section className="stroke-analytics" aria-label="Stroke analysis">
    <div className="stroke-analytics-heading"><div><p className="eyebrow">Stroke analysis</p><p className="workspace-caption">Generated painting strokes before machine ordering and joining. Colour shares describe strokes, not unique image coverage.</p></div>
      <label>Colour share by<select value={metric} onChange={e=>setMetric(e.target.value as typeof metric)}><option value="distance">Painting distance</option><option value="count">Stroke count</option></select></label>
    </div>
    {stale&&<p className="stroke-analytics-stale">Settings changed. Regenerate to update these graphs.</p>}
    {!data.count ? <p>No painting strokes to analyse.</p> : <>
      <dl className="stroke-analysis-metrics">{[["Strokes",data.count],["Painting distance",(data.totalDistanceMm/1000).toFixed(2)+" m"],["Median length",data.medianMm.toFixed(1)+" mm"],["Short strokes ≤ "+brushWidth.toFixed(1)+" mm",data.shortCount+" ("+Math.round(data.shortCount/data.count*100)+"%)"],["Colour changes",data.colourChanges]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="stroke-analysis-charts">
        <div className="stroke-analysis-chart"><h3>Colour distribution</h3>
          <svg className="stroke-colour-donut" viewBox="0 0 160 160" role="img" aria-label={"Colour shares by "+(metric==="distance"?"painting distance":"stroke count")}>
            <circle cx="80" cy="80" r="60" fill="none" stroke="#38352e" strokeWidth="24"/>
            {data.rows.map(row=>{const portion=share(row),start=offset;offset+=portion;return <circle key={row.paintId} cx="80" cy="80" r="60" fill="none" stroke={colour(row.paintId)} strokeWidth="24" strokeDasharray={portion*circumference+" "+circumference} strokeDashoffset={-start*circumference} transform="rotate(-90 80 80)" opacity={!active||active===row.paintId?1:.2}><title>{name(row.paintId)+": "+(portion*100).toFixed(1)+"%"}</title></circle>;})}
            <text x="80" y="78" textAnchor="middle" className="stroke-donut-value">{metric==="distance"?(data.totalDistanceMm/1000).toFixed(1)+" m":data.count}</text><text x="80" y="96" textAnchor="middle">{metric==="distance"?"painted distance":"strokes"}</text>
          </svg>
          <div className="stroke-colour-legend" aria-label="Filter by paint colour">
            <button type="button" className="stroke-colour-all" aria-pressed={!active} onClick={()=>setFocus(null)}>All colours</button>
            {data.rows.map(row=><button type="button" key={row.paintId} aria-pressed={active===row.paintId} onClick={()=>setFocus(active===row.paintId?null:row.paintId)}>
              <span className="paint-usage-swatch" style={{background:colour(row.paintId)}} aria-hidden="true"/><span>{name(row.paintId)}<small>{row.count} strokes · {(row.distanceMm/1000).toFixed(2)} m</small></span><b>{(share(row)*100).toFixed(1)}%</b>
            </button>)}
          </div>
        </div>
        <div className="stroke-analysis-chart"><h3>Stroke length distribution{active?" · "+name(active):""}</h3><p className="workspace-caption">Full polyline length in mm. Each bar counts strokes in that range.</p>
          <svg viewBox="0 0 520 280" className="stroke-length-chart" role="img" aria-label="Stroke length histogram">
            {[0,.5,1].map(t=><g key={t}><line x1="46" x2="510" y1={232-t*190} y2={232-t*190} stroke="#49453d"/><text x="39" y={236-t*190} textAnchor="end">{Number((max*t).toFixed(1))}</text></g>)}
            {bins.map((total,i)=>{let y=232;return <g key={i}>{histogramRows.map(row=>{const height=row.bins[i]/max*190;y-=height;return height>0?<rect key={row.paintId} x={52+i*57} y={y} width="42" height={height} fill={colour(row.paintId)}><title>{name(row.paintId)+": "+row.bins[i]+" strokes in "+strokeLengthLabels[i]+" mm"}</title></rect>:null;})}<text x={73+i*57} y="252" textAnchor="middle">{strokeLengthLabels[i]}</text><text x={73+i*57} y={232-total/max*190-6} textAnchor="middle">{total||""}</text></g>;})}
            <text x="280" y="275" textAnchor="middle">Stroke length · mm (upper boundary included)</text><text x="14" y="130" textAnchor="middle" transform="rotate(-90 14 130)">Count</text>
          </svg>
          <p className="workspace-caption">Short strokes are those no longer than the {brushWidth.toFixed(1)} mm brush width. Many short strokes can mean more lifts; actual machine time is calculated in Simulation.</p>
        </div>
      </div>
      <div className="stroke-analysis-chart stroke-sequence-chart"><h3>Colour order in the generated plan</h3><p className="workspace-caption">Each column summarises {data.sequence.length?data.sequence[0].end:1} consecutive strokes; stacked colours show their proportions. {active?"Selected colour highlighted.":"Select a colour in the legend to inspect it."}</p>
        <svg viewBox="0 0 920 160" role="img" aria-label="Paint colour sequence">
          {[0,50,100].map(t=><g key={t}><line x1="40" x2="900" y1={125-t} y2={125-t} stroke="#49453d"/><text x="32" y={129-t} textAnchor="end">{t}%</text></g>)}
          {data.sequence.map((window,i)=>{let y=125;const width=860/data.sequence.length;return <g key={i}>{data.rows.map(row=>{const count=window.counts.get(row.paintId)??0,height=count/(window.end-window.start+1)*100;y-=height;return height>0?<rect key={row.paintId} x={40+i*width} y={y} width={Math.max(.5,width-.5)} height={height} fill={colour(row.paintId)} opacity={!active||active===row.paintId?1:.15}><title>{"Strokes "+window.start+"–"+window.end+": "+name(row.paintId)+" · "+count+" strokes"}</title></rect>:null;})}</g>;})}
          {[0,.25,.5,.75,1].map(t=><text key={t} x={40+t*860} y="147" textAnchor={t===0?"start":t===1?"end":"middle"}>{Math.max(1,Math.round(t*data.count))}</text>)}
        </svg>
      </div>
    </>}
  </section>;
}
