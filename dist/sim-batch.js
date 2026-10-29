import {advanceTurn} from './simulation.js';

export const MAX_BATCH_TURNS=100;
const yieldToBrowser=()=>new Promise(resolve=>setTimeout(resolve,0));

// Each iteration uses the normal turn engine. Nothing mutates the live campaign
// until the caller applies the returned result, including when stopping early.
export async function advanceTurns(input,world,ownership,count,{onProgress=()=>{},shouldStop=()=>false,yieldControl=yieldToBrowser}={}){
 if(!Number.isInteger(count)||count<1||count>MAX_BATCH_TURNS)throw Error(`Enter a whole number from 1 to ${MAX_BATCH_TURNS}.`);
 let result={simulation:structuredClone(input),ownership:structuredClone(ownership)},completed=0;
 await onProgress(0,count);
 await yieldControl();
 while(completed<count&&!shouldStop()){
  // Old undo snapshots are unnecessary inside the batch and costly to copy.
  result=advanceTurn({...result.simulation,undo:null},world,result.ownership);
  completed++;
  await onProgress(completed,count);
  await yieldControl();
 }
 if(completed){
  const previous=structuredClone({...input,undo:null});delete previous.undo;
  const changes=[...new Set([...Object.keys(ownership),...Object.keys(result.ownership)])]
   .filter(id=>ownership[id]?.factionId!==result.ownership[id]?.factionId)
   .map(id=>({id,before:ownership[id]?.factionId,after:result.ownership[id]?.factionId}));
  result.simulation.undo={simulation:previous,changes};
 }
 return {...result,completed};
}
