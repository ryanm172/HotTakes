import { expect, test, type Page } from '@playwright/test';

async function setup(page:Page,judge=false){
  await page.setViewportSize({width:390,height:844});
  await page.route(/\/src\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
    export const configured=true;export class RoomUnavailable extends Error{};export class RoomDeparted extends Error{};
    const h={contestants:[{id:'aa',player:'a',name:'Alex',badge:'hot-breath',text:'Hot take A'},{id:'bb',player:'b',name:'Bob',badge:'hot-honey',text:'Hot take B'}],order:['aa','bb'],index:0,pool:3,judges:['c','d'],submitted:['d'],myVote:null};
    const s={code:'HOTSET',phase:'hotseat_ready',host:'a',me:${judge?"'c'":"'a'"},round:5,prompt:'Defend this take',deadline:null,history:[],hotseat:h,
      players:['a','b','c','d'].map((id,i)=>({id,name:['Alex','Bob','Cara','Dan'][i],badge:'hot-sauce',online:true,answered:true,voted:true,total:0})),
      answers:[{id:'aa',text:'Hot take A',author:'Alex',badge:'hot-breath',heat:80},{id:'bb',text:'Hot take B',author:'Bob',badge:'hot-honey',heat:80}]};
    window.hotseatCalls=[];
    function advance(){h.index++;s.deadline=null;s.phase=h.index===2?'hotseat_voting':'hotseat_ready';}
    export async function callGame(action,code,payload){
      if(s.phase==='hotseat_speaking'&&Date.now()>=Date.parse(s.deadline))advance();
      if(window.forceHotSeatVoting){s.phase='hotseat_voting';h.index=2;s.deadline=null;window.forceHotSeatVoting=false;}
      if(action.startsWith('hotseat_')){
        window.hotseatCalls.push({action,payload});
        if(payload.round!==5||payload.prompt!==s.prompt)throw new Error('Missing round token');
      }
      if(action==='hotseat_start'){s.phase='hotseat_speaking';s.deadline=new Date(Date.now()+60000).toISOString();}
      if(action==='hotseat_done')advance();
      if(action==='hotseat_vote'){
        h.submitted=['c','d'];h.myVote=payload.candidate;s.phase='finished';
        s.answers=s.answers.map(a=>({...a,points:a.id===payload.candidate?3:0,defenseVotes:a.id===payload.candidate?2:0,hottest:a.id!==payload.candidate}));
        s.players=s.players.map(p=>({...p,total:p.id===(payload.candidate==='aa'?'a':'b')?3:0}));
      }
      return structuredClone(s);
    }
    export async function leaveGame(){return {phase:s.phase};}
  `}));
  await page.addInitScript(()=>localStorage.setItem('hot-room','HOTSET'));
  await page.goto('/');await expect(page.getByRole('region',{name:'Hot Seat',exact:true})).toBeVisible();
}

test('host starts speakers, contestants can finish early, and cannot vote',async({page})=>{
  await setup(page);
  await expect(page.getByRole('heading',{name:'Too close to call'})).toBeVisible();
  await expect(page.getByText('3 points at stake.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Start Hot Seat',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Alex is in the Hot Seat/})).toBeVisible();
  await expect(page.getByRole('timer')).toContainText('60s');
  await page.screenshot({path:'artifacts/mobile-hot-seat.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:"I'm done",exact:true}).click();
  await page.getByRole('button',{name:'Start next speaker'}).click();
  await expect(page.getByRole('heading',{name:/Bob is in the Hot Seat/})).toBeVisible();
  await expect(page.getByRole('button',{name:"I'm done",exact:true})).toBeHidden();
  await page.evaluate(()=>{(window as any).forceHotSeatVoting=true;});
  await expect(page.getByText("You're a Hot Seat contestant.",{exact:false})).toBeVisible({timeout:7000});
  await expect(page.getByRole('radio')).toHaveCount(0);
  const calls=await page.evaluate(()=>(window as any).hotseatCalls);
  expect(calls[0].payload.speaker).toBe('aa');expect(calls[2].payload.speaker).toBe('bb');
});

test('outside judge selects then submits, and round five cannot finish before the verdict',async({page})=>{
  await setup(page,true);await page.evaluate(()=>{(window as any).forceHotSeatVoting=true;});
  await expect(page.getByRole('radio')).toHaveCount(2,{timeout:7000});
  await expect(page.getByRole('button',{name:'View game recap'})).toBeHidden();
  await expect(page.getByRole('button',{name:'Submit explanation vote'})).toBeDisabled();
  await page.getByRole('radio').first().check();
  expect(await page.evaluate(()=>(window as any).hotseatCalls.length)).toBe(0);
  await page.getByRole('button',{name:'Submit explanation vote'}).click();
  await expect(page.getByRole('heading',{name:'The Hot Seat verdict'})).toBeVisible();
  await expect(page.getByRole('button',{name:'View game recap'})).toBeVisible();
  await expect(page.locator('.hotseat-outcome')).toContainText('Alex: 2 votes');
  await expect(page.locator('.result-card').filter({hasText:'Hot take B'})).toContainText('Hottest take');
});

test('the speaking countdown advances through polling after its deadline',async({page})=>{
  await page.clock.install();await setup(page);
  await page.getByRole('button',{name:'Start Hot Seat',exact:true}).click();
  await page.clock.fastForward(61000);
  await expect(page.getByRole('button',{name:'Start next speaker'})).toBeVisible();
});
