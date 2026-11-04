import { expect, test } from '@playwright/test';

test('recap shows shared ranks and tied highlights, and survives refresh',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route(/\/src\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
    export const configured=true;
    export class RoomUnavailable extends Error {}
    export class RoomDeparted extends Error {}
    export async function leaveGame(){return {phase:'finished'};}
    export async function callGame(){return {
      code:'RECAPX',phase:'finished',host:'a',me:'b',round:5,prompt:'Last prompt',deadline:null,answers:[],
      players:[{id:'c',name:'Third',total:4},{id:'a',name:'Alex',total:9},{id:'d',name:'Fourth',total:2},{id:'b',name:'Bob',total:9}],
      history:Array.from({length:5},(_,i)=>({round:i+1,prompt:'Prompt '+(i+1),takes:[
        {id:'a'+i,text:'Hot take '+(i+1),author:'Alex'},
        {id:'b'+i,text:'Equally hot '+(i+1),author:'Bob'}]}))
    };}
  `}));
  await page.addInitScript(()=>localStorage.setItem('hot-room','RECAPX'));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Final scoreboard'})).toBeHidden();
  await page.getByRole('button',{name:'View game recap'}).click();
  await expect(page.getByRole('heading',{name:/Alex & Bob/})).toBeVisible();
  const rows=page.locator('.recap-scoreboard tbody tr');
  await expect(rows.locator('td:first-child')).toHaveText(['1','1','3','4']);
  await expect(rows.nth(1)).toContainText('Bob (you)');
  await expect(page.getByLabel('Winner')).toHaveCount(2);
  await expect(page.locator('.recap-round')).toHaveCount(5);
  await expect(page.locator('.recap-round blockquote')).toHaveCount(10);
  await expect(page.locator('.recap-round').first()).toContainText('Prompt 1');
  await expect(page.locator('.players-panel')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Final scoreboard'})).toBeVisible();
});
