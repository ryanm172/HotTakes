import { expect, type Page } from '@playwright/test';

export async function finishPracticeHotSeat(page:Page){
  if(!await page.getByRole('button',{name:'Start Hot Seat',exact:true}).count())return;
  for(let i=0;i<8;i++){
    const start=page.getByRole('button',{name:/^(Start Hot Seat|Start next speaker)$/});
    if(!await start.count())break;
    await start.click();
    const finish=page.getByRole('button',{name:/^(I'm done|Practice: finish simulated speech)$/});
    await expect(finish).toBeVisible();await finish.click();
  }
  const vote=page.getByRole('button',{name:'Submit explanation vote'});
  if(await vote.count()){await page.getByRole('radio').first().check();await vote.click();}
}
