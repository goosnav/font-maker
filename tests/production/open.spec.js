import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/recovery", r => r.fulfill({status:r.request().method()==="PUT"?204:404}));
  await page.goto("/");
  await page.getByRole("button", {name:"Continue drawing",exact:true}).click();
});
async function openFont(page) {
  await page.getByRole("button",{name:"Open",exact:true}).click();
  const chooser=page.waitForEvent("filechooser");
  await page.locator('.open-menu [data-command="open-font"]').click();
  await (await chooser).setFiles("public/fonts/liberation-sans.ttf");
  await expect(page.getByRole("dialog",{name:"New font",exact:true})).toBeVisible({timeout:60000});
}
async function save(page) {
  await page.evaluate(()=>delete window.showSaveFilePicker);
  await page.getByRole("button",{name:"Save",exact:true}).click();
  const downloaded=page.waitForEvent("download");
  await page.locator('.save-menu [data-command="save"]').click();
  return await (await downloaded).path();
}

test("Open matches Save, has icons, supports keyboard and reloads a project", async ({page})=>{
  await expect(page.locator('.toolbar [data-command="new"] svg path')).not.toHaveCount(0);
  await expect(page.locator('.open-menu svg path')).not.toHaveCount(0);
  const open=page.getByRole("button",{name:"Open",exact:true});
  await open.focus();await page.keyboard.press("Enter");
  await expect(page.locator('.open-menu [data-command="open"]')).toBeVisible();
  await expect(page.locator('.open-menu [data-command="open-font"]')).toBeVisible();
  await page.keyboard.press("Escape");await expect(open).toBeFocused();
  await expect(page.locator('.open-menu')).not.toHaveAttribute("open","");
  await open.click();await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.locator('.open-menu')).not.toHaveAttribute("open","");
  await page.keyboard.press("Escape");
  await page.locator('#book-name').fill('Open round trip');await page.locator('#quick-text').focus();
  const file=await save(page);
  await open.click();const chooser=page.waitForEvent('filechooser');await page.locator('.open-menu [data-command="open"]').click();await(await chooser).setFiles(file);
  await expect(page.locator('#book-name')).toHaveValue('Open round trip');
});

test("Open font configures editable pixel characters and conversion fills a real progress bar", async ({page})=>{
  test.setTimeout(150000);
  await openFont(page);
  await expect(page.getByRole('radio',{name:'Editable font',exact:true})).toBeChecked();
  await expect(page.locator('#new-reference')).toHaveValue(/^import-/);
  await page.locator('#new-name').fill('Opened pixels');
  await page.locator('#new-source-characters').uncheck();
  await page.locator('[name=pack][value=latin]').check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('#setting-mode')).toHaveValue('detailed');
  await page.locator('#setting-mode').selectOption('pixel');
  await expect(page.locator('.paint-canvas')).toHaveAttribute('data-reference','ready');
  await page.evaluate(()=>{
    window.conversionFrames=[];
    new MutationObserver(()=>{
      const bar=document.querySelector('.settings-progress [role=progressbar]');
      if(!bar||!bar.hasAttribute('aria-valuenow'))return;
      const box=bar.getBoundingClientRect();
      window.conversionFrames.push({done:+bar.getAttribute('aria-valuenow'),total:+bar.getAttribute('aria-valuemax'),width:parseFloat(getComputedStyle(bar,'::after').width),track:box.width,visible:box.height>0&&box.bottom<=innerHeight});
    }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-valuenow']});
  });
  await page.getByRole('button',{name:'Start drawing',exact:true}).click();
  await expect(page.locator('.settings-dialog')).toHaveCount(0,{timeout:60000});
  const prepared=await page.evaluate(()=>window.conversionFrames);
  expect(prepared.some(f=>f.done>0&&f.done<f.total&&f.visible&&f.width>0&&f.width<f.track)).toBe(true);
  expect(prepared.at(-1).done).toBe(prepared.at(-1).total);
  await expect(page.locator('[data-cp="65"]')).toHaveAttribute('data-status','inherited');
  await page.locator('#book-resolution').selectOption('32');
  await page.evaluate(()=>window.conversionFrames=[]);
  await page.getByRole('button',{name:'Apply settings',exact:true}).click();
  await expect(page.locator('.settings-dialog')).toHaveCount(0,{timeout:60000});
  const converted=await page.evaluate(()=>window.conversionFrames);
  expect(converted.some(f=>f.done>0&&f.done<f.total&&f.visible)).toBe(true);
  expect(converted.at(-1).done).toBe(converted.at(-1).total);
  expect(converted.every((f,i)=>!i||f.done>=converted[i-1].done)).toBe(true);
  const files=unzipSync(new Uint8Array(await readFile(await save(page))));
  const p=JSON.parse(strFromU8(files['project.json']));
  expect(p.name).toBe('Opened pixels');expect(p.settings.resolution).toBe(32);
  expect(p.glyphs[65].bitmap).toBeTruthy();expect(p.fonts).toHaveLength(1);expect(p.fonts[0].license).toBeTruthy();
});

test("Open font can be a reference; cancelling setup preserves the current book", async ({page})=>{
  await openFont(page);
  await page.getByRole('radio',{name:'Reference font',exact:true}).check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('#setting-reference')).toHaveValue(/^import-/);
  await expect(page.locator('.paint-canvas')).toHaveAttribute('data-reference','ready');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('#book-name')).toHaveValue('My Font');
  await openFont(page);
  await page.locator('#new-name').fill('Tracing only');
  await page.getByRole('radio',{name:'Reference font',exact:true}).check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Start drawing',exact:true}).click();
  await expect(page.locator('.settings-dialog')).toHaveCount(0);
  await expect(page.locator('#book-name')).toHaveValue('Tracing only');
  await expect(page.locator('[data-status="inherited"]')).toHaveCount(0);
  const files=unzipSync(new Uint8Array(await readFile(await save(page))));
  const p=JSON.parse(strFromU8(files['project.json']));
  expect(Object.keys(p.glyphs)).toHaveLength(0);expect(p.fonts).toHaveLength(1);expect(p.settings.reference).toBe(p.fonts[0].id);
});

test("busy loader scrolls forward and respects reduced motion", async ({page})=>{
  let release;const gate=new Promise(r=>release=r);
  await page.route('**/engine/font.worker.js',async r=>{await gate;await r.continue()});
  await page.getByRole('button',{name:'Open',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');await page.locator('.open-menu [data-command="open-font"]').click();await(await chooser).setFiles('public/fonts/liberation-sans.ttf');
  const bar=page.locator('.busy [role=progressbar]');await expect(bar).toBeVisible();
  await expect(bar).not.toHaveAttribute('aria-valuenow',/.+/);
  const animation=await bar.evaluate(e=>{const s=getComputedStyle(e,'::after');return {direction:s.animationDirection,timing:s.animationTimingFunction}});
  expect(animation).toEqual({direction:'normal',timing:'linear'});
  await page.emulateMedia({reducedMotion:'reduce'});
  expect(await bar.evaluate(e=>getComputedStyle(e,'::after').animationName)).toBe('none');
  release();await expect(page.locator('.new-project-dialog')).toBeVisible({timeout:60000});
});
