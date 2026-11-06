import { test, expect } from '@playwright/test';
/** Follow visible local setup to the account form. */
async function setup(page) {
 await page.goto('/');
 await page.getByRole('button',{name:'Continue offline',exact:true}).click();
 await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
 await page.getByLabel('Preferred name',{exact:true}).fill('Anthony');
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.getByText('Philippine Peso (PHP)',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await expect(page.getByLabel('Account name',{exact:true})).toHaveValue('Cash');
 await expect(page.getByLabel('Opening balance (PHP)',{exact:true})).toHaveValue('0');
}
test('setup persists offline and hands ownership to another tab',async({page,context})=>{
 await setup(page);
 await page.getByLabel('Opening balance (PHP)',{exact:true}).fill('1234.56');
 await page.getByRole('button',{name:'Save my account',exact:true}).click();
 await expect(page.getByText('₱1,234.56',{exact:true})).toBeVisible();
 const second=await context.newPage();await second.goto('/');
 await expect(second.getByRole('alert')).toContainText('Database busy');
 await page.getByRole('button',{name:'Close database',exact:true}).click();
 await second.getByRole('button',{name:'Retry opening',exact:true}).click();
 await expect(second.getByText('₱1,234.56',{exact:true})).toBeVisible();
 await second.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await page.close(); await second.close();
 await context.setOffline(true);
 const reopened=await context.newPage();await reopened.goto('/');
 await expect(reopened.getByText('Welcome, Anthony.',{exact:true})).toBeVisible();
 await expect(reopened.getByText('₱1,234.56',{exact:true})).toBeVisible();
});
test('reject invalid decimal input without completing setup',async({page})=>{
 await setup(page);await page.getByLabel('Opening balance (PHP)',{exact:true}).fill('1.234');
 await page.getByRole('button',{name:'Save my account',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('two decimal places');
 await page.reload();await expect(page.getByRole('button',{name:'Continue offline',exact:true})).toBeVisible();
});
