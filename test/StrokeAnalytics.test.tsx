// @vitest-environment jsdom
import {afterEach,expect,test} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {StrokeAnalytics} from "../src/ui/StrokeAnalytics.tsx";
import {createProject} from "../src/project/model.ts";
import type {PaintingPlan,Stroke} from "../src/core/model.ts";
afterEach(cleanup);
const stroke=(paintId:string,length:number):Stroke=>({type:"stroke",paintId,points:[{x:0,y:0},{x:length,y:0}],pressure:.5,speedMmPerMin:300,expectedLoadStart:1,expectedLoadEnd:0});
const plan:PaintingPlan={formatVersion:1,projectId:"test",operations:[stroke("cadmium-red",10),stroke("ultramarine-blue",2)]};
test("graphs use generated strokes, toggle share metric and let a colour filter the histogram",()=>{
  const palette=createProject().palette,paint=palette.find(p=>p.id==="cadmium-red")!;
  render(<StrokeAnalytics plan={plan} palette={palette} brushWidth={6} stale={false}/>);
  expect(screen.getByRole("img",{name:"Colour shares by painting distance"})).toBeTruthy();expect(screen.getByText("83.3%")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Colour share by"),{target:{value:"count"}});
  expect(screen.getByRole("img",{name:"Colour shares by stroke count"})).toBeTruthy();expect(screen.getAllByText("50.0%")).toHaveLength(2);
  const button=screen.getByRole("button",{name:new RegExp(paint.name)});fireEvent.click(button);
  expect(button.getAttribute("aria-pressed")).toBe("true");expect(screen.getByText("Stroke length distribution · "+paint.name)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"All colours"}));expect(screen.getByText("Stroke length distribution")).toBeTruthy();
});
test("stale and empty generated plans have clear states",()=>{
  render(<StrokeAnalytics plan={{...plan,operations:[]}} palette={createProject().palette} brushWidth={6} stale={true}/>);
  expect(screen.getByText(/Regenerate to update/)).toBeTruthy();expect(screen.getByText("No painting strokes to analyse.")).toBeTruthy();expect(screen.queryByRole("img")).toBeNull();
});
