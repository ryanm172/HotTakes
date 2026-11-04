import { test, expect, type Page } from '@playwright/test';

// Replace only the network boundary; exercise the real React UI and browser storage.
async function mockGame(page:Page,phase='voting',failLeave=false){
  await page.route(/\/src\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
    export const configured=true;
    export class RoomUnavailable extends Error {}
    export class RoomDeparted extends Error {}
    let departed=false;
    const snapshot={code:'ABCDEF',phase:${JSON.stringify(phase)},host:'me',me:'me',round:1,prompt:'A prompt',deadline:null,
      players:[{id:'me',name:'Tester',online:true,answered:true,voted:true,total:0}],answers:[],history:[]};
    export async function callGame(action){
      if(action==='resume'){departed=false;return snapshot;}
      if(departed)throw new RoomDeparted('You left this room in another tab.');
      return snapshot;
    }
    export async function leaveGame(){${failLeave?"throw new Error('Offline');":"departed=true;return {phase:snapshot.phase};"}}
  `}));
  await page.addInitScript(()=>{localStorage.setItem('hot-room','ABCDEF');});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Leave room'})).toBeVisible();
}
test('active Leave requires confirmation, saves return link, and restores the game',async({page})=>{
  await mockGame(page);
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'Leave room'}).click();
  await expect(page.getByRole('button',{name:'Leave room'})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Leave room'}).click();
  await expect(page.getByRole('button',{name:/Return to game/})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('hot-room'))).toBeNull();
  await page.getByRole('button',{name:/Return to game/}).click();
  await expect(page.getByRole('button',{name:'Leave room'})).toBeVisible();
});
test('failed departure offers retry and local exit while preserving return',async({page})=>{
  await mockGame(page,'voting',true);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Leave room'}).click();
  await expect(page.getByRole('button',{name:'Retry leaving'})).toBeVisible();
  await page.getByRole('button',{name:'Leave on this device'}).click();
  await expect(page.getByRole('button',{name:/Return to game/})).toBeVisible();
});
test('finished departure saves results without confirmation',async({page})=>{
  await mockGame(page,'finished');
  await page.getByRole('button',{name:'View game recap'}).click();
  await page.getByRole('button',{name:'Back to the start'}).click();
  await expect(page.getByRole('button',{name:/View last results/})).toBeVisible();
});
test('departure in another tab stops this tab and exposes the saved return link',async({page,context})=>{
  await mockGame(page);
  const sibling=await context.newPage();
  await sibling.goto('/');
  await sibling.evaluate(()=>{
    localStorage.setItem('hot-departure',JSON.stringify({code:'ABCDEF',at:Date.now()}));
    localStorage.setItem('hot-return',JSON.stringify({code:'ABCDEF',finished:false}));
  });
  await expect(page.getByRole('button',{name:'Leave room'})).toBeHidden();
  await expect(page.getByRole('button',{name:/Return to game/})).toBeVisible();
});
