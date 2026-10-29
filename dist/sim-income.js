// Optional map-scale adaptation: one territorial income term alongside SWN income.
import {planetTraits} from './models.js';

export function locationIncome(location){
 const {population}=planetTraits(location),tl=Math.max(0,Math.min(5,Math.floor(location.tl??4)));
 if(['system','blackHole','asteroidBelt','orbitalRuin'].includes(location.type))return {credits:0,reason:'No productive settlement'};
 if(population===0)return {credits:0,reason:'Uninhabited'};
 if(['planet','moon'].includes(location.type)){
  const populationIncome=population===null?(location.type==='planet'?1:0):population<1e5?1:population<1e8?2:population<1e9?3:4;
  const techCap=tl<2?1:tl<3?2:tl<4?3:4;
  const credits=Math.min(populationIncome,techCap)+(populationIncome>0&&tl>=5?1:0);
  return {credits,reason:`${population===null?'Population unrecorded':population.toLocaleString('en-US')+' inhabitants'} · TL${tl}`};
 }
 const occupation=String(location.attributes?.occupation||'');
 if(/abandoned|uninhabited|no inhabitants/i.test(occupation))return {credits:0,reason:'Abandoned facility'};
 const commercial=/mine|station|asteroidBase|industr|factory|refiner/i.test(location.type)||/manufactur|industrial|merchant|trading|miners|prospectors/i.test(occupation);
 const research=/research/i.test(location.type);
 const credits=tl>=5||tl>=4&&(commercial||research)?3:2;
 return {credits,reason:`${commercial?'Production / trade':'Operational facility'} · TL${tl}`};
}

export function territorialIncome(sim,id,world,saved={}){
 const faction=sim.factions[id];
 if(sim.incomeModel==='standard'||!world||!faction||faction.hp<=0||faction.archived)return {territory:0,territoryDetails:[]};
 const territoryDetails=world.locations.filter(l=>saved[l.id]?.factionId===id).map(l=>{
  const local=locationIncome(l),capitalBonus=local.credits>0&&faction.home===l.id?1:0;
  return {locationId:l.id,credits:local.credits+capitalBonus,capitalBonus,reason:local.reason};
 });
 return {territory:territoryDetails.reduce((sum,l)=>sum+l.credits,0),territoryDetails};
}
