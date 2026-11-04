import { test, expect } from '@playwright/test';

test('mobile practice plays five rounds and shows a winner',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/Your opinions/})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/mobile-home.png',fullPage:true});
  await page.getByRole('button',{name:'How to play'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button',{name:/Try a practice game/}).click();
  await page.getByRole('button',{name:/Start the game/}).click();
  for(let round=1;round<=5;round++){
    await expect(page.getByText(`ROUND ${round} OF 5`,{exact:true})).toBeVisible();
    await page.getByLabel('YOUR HOT TAKE',{exact:true}).fill(`Practice opinion ${round}`);
    await page.getByRole('button',{name:'Lock in my take'}).click();
    await expect(page.getByRole('heading',{name:/Who brought/})).toBeVisible();
    await expect(page.getByText(`Practice opinion ${round}`,{exact:true})).toBeHidden();
    const first=await page.locator('.rank-card p').first().textContent();
    await page.getByRole('button',{name:'Move answer 1 colder'}).click();
    expect(await page.locator('.rank-card p').nth(1).textContent()).toBe(first);
    if(round===1)await page.screenshot({path:'artifacts/mobile-voting.png',fullPage:true});
    await page.getByRole('button',{name:'Submit my ranking'}).click();
    await expect(page.getByText(`Practice opinion ${round}`,{exact:true})).toBeVisible();
    if(round<5)await page.getByRole('button',{name:'Next round'}).click();
  }
  await expect(page.getByText('THAT’S A WRAP',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
  await page.getByRole('button',{name:'Back to the start'}).click();
  await expect(page.getByRole('heading',{name:/Your opinions/})).toBeVisible();
});

test('desktop layout and unconfigured online mode are honest',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/');
  await page.getByLabel('WHAT SHOULD WE CALL YOU?').fill('Tester');
  await page.getByRole('button',{name:'Turn up the heat'}).click();
  await expect(page.getByRole('alert')).toContainText('Online rooms need Supabase setup');
  await page.getByRole('button',{name:'Dismiss error'}).click();
  await page.screenshot({path:'artifacts/desktop-home.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
