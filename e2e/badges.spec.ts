import { expect, test, type Page } from '@playwright/test';

async function onlineLobby(page:Page){
  await page.route(/\/src\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
    export const configured=true;
    export class RoomUnavailable extends Error {}
    export class RoomDeparted extends Error {}
    let badge='hot-sauce';
    export async function callGame(action,code,payload){
      if(action==='badge'){
        if(window.badgeFailure)throw new Error('Save failed');
        if(!window.gameStarted)badge=payload.badge;
      }
      return {code:'BADGES',phase:window.gameStarted?'voting':'lobby',host:'other',me:'me',round:1,prompt:'Test',deadline:null,answers:[],history:[],players:[
        {id:'me',name:'Tester',badge,online:true,answered:true,voted:true,total:0},
        {id:'other',name:'Other',badge:'hot-sun',online:true,answered:true,voted:true,total:0}]};
    }
    export async function leaveGame(){return {phase:'lobby'};}
  `}));
  await page.addInitScript(()=>{localStorage.setItem('hot-room','BADGES');localStorage.setItem('hot-badge','hot-sauce');});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Change your icon'})).toBeVisible();
}

test('phone picker shows eight mascots, saves on tap, and remembers the choice',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  const trigger=page.getByRole('button',{name:'Choose player icon'});
  await expect(trigger).toContainText('Hot Sauce');await trigger.click();
  const dialog=page.getByRole('dialog');await expect(dialog.locator('.badge-option')).toHaveCount(8);
  await expect(dialog.getByRole('button',{name:'Hot Sauce',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/mobile-badge-picker.png',fullPage:true});
  await dialog.getByRole('button',{name:'Hot Breath',exact:true}).click();
  await expect(dialog).toBeHidden();await expect(trigger).toContainText('Hot Breath');
  await page.reload();await expect(trigger).toContainText('Hot Breath');
  await trigger.click();await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
});

test('practice uses the selected mascot but keeps badges off anonymous answer cards',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Choose player icon'}).click();
  await page.getByRole('button',{name:'Hot Honey',exact:true}).click();
  await page.getByRole('button',{name:/Try a practice game/}).click();
  await expect(page.getByRole('button',{name:'Change your icon'}).getByRole('img',{name:'Hot Honey'})).toBeVisible();
  await page.getByRole('button',{name:'Start the game'}).click();
  await expect(page.getByRole('button',{name:'Change your icon'})).toBeHidden();
  await page.getByLabel('YOUR HOT TAKE',{exact:true}).fill('My honey take');
  await page.getByRole('button',{name:'Lock in my take'}).click();
  await expect(page.locator('.rank-card [role=img]')).toHaveCount(0);
  await page.getByRole('button',{name:'Submit my ranking'}).click();
  await expect(page.locator('.result-card').filter({hasText:'My honey take'}).getByRole('img',{name:'Hot Honey'})).toBeVisible();
});

test('failed lobby save retains the previous icon and allows retry',async({page})=>{
  await onlineLobby(page);await page.evaluate(()=>{(window as any).badgeFailure=true;});
  await page.getByRole('button',{name:'Change your icon'}).click();
  await page.getByRole('button',{name:'Hot Potato',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('previous icon');
  await expect(page.getByRole('button',{name:'Hot Sauce',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>localStorage.getItem('hot-badge'))).toBe('hot-sauce');
  await page.evaluate(()=>{(window as any).badgeFailure=false;});
  await page.getByRole('button',{name:'Hot Potato',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button',{name:'Change your icon'}).getByRole('img',{name:'Hot Potato'})).toBeVisible();
});

test('another player starting closes the picker and locks the saved icon',async({page})=>{
  await onlineLobby(page);await page.getByRole('button',{name:'Change your icon'}).click();
  await page.evaluate(()=>{(window as any).gameStarted=true;});
  await expect(page.getByRole('dialog')).toBeHidden({timeout:7000});
  await expect(page.getByRole('button',{name:'Change your icon'})).toBeHidden();
  await expect(page.locator('.player-row').filter({hasText:'Tester'}).getByRole('img',{name:'Hot Sauce'})).toBeVisible();
});

test('a save arriving after game start keeps the server-approved badge',async({page})=>{
  await onlineLobby(page);await page.getByRole('button',{name:'Change your icon'}).click();
  await page.evaluate(()=>{(window as any).gameStarted=true;});
  await page.getByRole('button',{name:'Hot Coffee',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.evaluate(()=>localStorage.getItem('hot-badge'))).toBe('hot-sauce');
});
