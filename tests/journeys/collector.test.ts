import { afterAll, beforeAll, describe, it } from 'vitest';
import { SEED_USERNAME, fixtureEmail } from '../integration/helpers/http';
import { closeDb } from '../integration/helpers/db';
import {
  PASSWORD,
  aShelf,
  activeCollector,
  fund,
  gone,
  holds,
  openPage,
  panel,
  says,
  shows,
  signInAs,
  signOut,
  stack,
  uniqueUsername,
  verificationLink,
  type Stack,
} from './helpers/journey';

let s: Stack;

beforeAll(async () => {
  s = await stack();
});

afterAll(async () => {
  await s?.close();
  await closeDb();
});

describe('journey: a collector, from sign-up to cash-out', () => {
  it('signs up, sends a parcel, has it booked in and shelved, sells it, and is paid out', async () => {
    const page = await openPage(s, 'collector');
    const email = fixtureEmail('journey');
    const username = uniqueUsername('jrny');
    const tracking = `9400${Date.now()}${Math.floor(Math.random() * 1e4)}`;
    const description = `Rayquaza VMAX 218/203, journey ${username}`;
    const buyer = await activeCollector('buyer');
    await fund(buyer, 50_000);

    await page.goto('/#/');
    await page.goto('/#/sign-in');
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await shows(page.getByRole('heading', { name: 'Create an account' }));
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('First name').fill('Jordan');
    await page.getByLabel('Last name').fill('Journey');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('checkbox', { name: /I agree to the Terms of Service/ }).check();
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await shows(page.getByText(`You're registered! Your username is ${username}. Check your email to verify.`));

    await page.goto(await verificationLink(email));
    await shows(page.getByText('Your address is confirmed and the account is active. You can sign in.'));

    await signInAs(page, username, PASSWORD);
    await shows(page.getByRole('heading', { name: 'My vault', level: 1 }));

    await page.getByRole('button', { name: 'My account' }).click();
    await page.getByRole('menuitem', { name: /Profile/ }).click();
    await page.getByRole('tab', { name: 'Addresses' }).click();
    await shows(page.getByRole('heading', { name: 'Shipping addresses' }));
    await page.getByLabel('Country').selectOption({ label: 'United States' });
    await page.getByLabel('Label (e.g. Home)').fill('Home');
    await page.getByLabel('Recipient name').fill('Jordan Journey');
    await page.getByLabel('Street and number').fill('12 Vine St');
    await page.getByLabel('City').fill('Trenton');
    await page.getByLabel('State / province').selectOption({ label: 'NJ — New Jersey' });
    await page.getByLabel('Postal code').fill('08608');
    await page.getByRole('button', { name: 'Add address' }).click();
    await says(page.getByRole('article', { name: 'Home' }), '12 Vine St');

    await page.getByRole('button', { name: 'Inbound', exact: true }).click();
    await page.getByRole('tab', { name: 'Parcels' }).click();
    await shows(page.getByText('No parcels yet'));
    await shows(page.getByRole('heading', { name: 'Tell us a parcel is coming' }));
    await page.getByLabel('Carrier').fill('USPS');
    await page.getByLabel('Tracking number').fill(tracking);
    await page.getByLabel('What should be inside').fill('One raw Rayquaza single in a top-loader.');
    await page.getByRole('button', { name: 'Register parcel' }).click();
    const registered = page.getByRole('status').filter({ hasText: /^Registered parcel PKG-/ });
    await says(registered, 'You will get a notification when the warehouse checks it in.');
    const parcelCode = /PKG-[A-Z0-9]+/.exec((await registered.textContent()) ?? '')![0];
    await says(page.getByRole('list', { name: 'Your parcels' }), parcelCode);
    await signOut(page);

    await signInAs(page, SEED_USERNAME.operator);
    await page.getByRole('tab', { name: 'Receiving' }).click();
    await shows(page.getByRole('heading', { name: 'Receive an arrival' }));
    await page.getByLabel('Username on the parcel').fill(username);
    await page.getByLabel('Carrier').first().fill('USPS');
    await page.getByLabel('Tracking number').first().fill(tracking);
    await page.getByRole('button', { name: 'Receive parcel' }).click();
    await shows(page.getByText(`Next: open and check ${parcelCode} in Inbound parcels below.`));

    const row = page.getByRole('row', { name: new RegExp(parcelCode) });
    await says(row, `@${username}`);
    await row.getByRole('button', { name: 'Open and check' }).click();
    await row.getByLabel('What you found').fill('Box sound, one card in a top-loader.');
    await row.getByRole('button', { name: 'Open and check' }).click();
    await shows(
      page.getByText(`Parcel ${parcelCode} opened and the arrival check recorded. Next: book what is inside on the Receive bench.`),
    );
    await row.getByRole('button', { name: 'Book contents' }).click();
    await holds(page.getByLabel('Owner username'), username);
    await page.getByLabel('Where it goes').selectOption({ label: 'Decide the shelf later' });
    await page.getByLabel('Why later').selectOption({ label: 'Shelf full' });
    await page.getByLabel('Description').fill(description);
    await page.getByRole('button', { name: 'Intake', exact: true }).click();
    await says(page.getByRole('status').filter({ hasText: 'Booked in' }), '1 → Later');
    await says(row, '1 booked from this parcel so far.');

    await page.getByRole('tab', { name: 'Inventory' }).click();
    const toShelve = panel(page, 'To shelve');
    await shows(toShelve);
    const waiting = toShelve.getByRole('row', { name: new RegExp(description) });
    await says(waiting, parcelCode);
    await says(waiting, `@${username}`);
    await says(waiting, 'Shelf full');
    await waiting.getByRole('button', { name: /^Stow SN-/ }).click();
    await toShelve.getByLabel('Scan shelf').fill(await aShelf());
    await toShelve.getByRole('button', { name: 'Relocate' }).click();
    await gone(waiting);
    await signOut(page);

    await signInAs(page, username, PASSWORD);
    await page.getByRole('button', { name: 'Marketplace', exact: true }).click();
    await page.getByRole('tab', { name: 'Sell' }).click();
    await shows(page.getByRole('heading', { name: 'Sell an item' }));
    await page.getByRole('radio', { name: new RegExp(description) }).check();
    await page.getByRole('textbox', { name: 'Asking price', exact: true }).fill('40');
    await page.getByRole('button', { name: 'List for sale' }).click();
    await says(
      page.getByRole('status').filter({ hasText: 'Buyers can buy it or make an offer, and offers show up under Offers.' }),
      'at $40.00.',
    );
    await says(page.getByRole('list', { name: 'My listings' }).getByRole('listitem').filter({ hasText: description }), 'Active');
    await signOut(page);

    await signInAs(page, buyer.email, PASSWORD);
    await page.getByRole('button', { name: 'Marketplace', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search' }).fill(username);
    const listing = page.getByRole('listitem').filter({ hasText: description });
    await says(listing, '$40.00');
    await listing.getByRole('button', { name: 'Buy' }).click();
    const confirm = page.getByRole('dialog', { name: 'Confirm purchase' });
    await says(confirm, 'for $40.00? The amount is charged to your wallet.');
    await says(confirm, 'The item moves to your vault as soon as you confirm.');
    await confirm.getByRole('button', { name: 'Buy', exact: true }).click();
    await says(page.getByRole('status').filter({ hasText: /^Bought / }), 'for $40.00. It is in your vault now.');
    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await shows(page.getByRole('heading', { name: 'My vault', level: 1 }));
    await shows(page.getByRole('listitem').filter({ hasText: description }));
    await signOut(page);

    await signInAs(page, username, PASSWORD);
    await page.getByRole('button', { name: 'Wallet', exact: true }).click();
    await page.getByRole('tab', { name: 'Cash out' }).click();
    await shows(page.getByRole('heading', { name: 'Request cash out' }));
    await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('20');
    await page.getByRole('textbox', { name: 'Destination account', exact: true }).fill('IL62 0108 0000 0009 9999 999');
    await page.getByRole('textbox', { name: 'Beneficiary name', exact: true }).fill('Jordan Journey');
    await page.getByRole('button', { name: 'Submit request' }).click();
    const sent = page.getByText(/^Request WR-[A-Z0-9]+ for \$20\.00 was sent for review\./);
    await shows(sent);
    const requestCode = /WR-[A-Z0-9]+/.exec((await sent.textContent()) ?? '')![0];
    await signOut(page);

    await signInAs(page, SEED_USERNAME.admin);
    await page.getByRole('button', { name: 'Management', exact: true }).click();
    await page.getByRole('tab', { name: 'Wallet requests' }).click();
    const request = page.getByRole('row', { name: new RegExp(requestCode) });
    await says(request, '$20.00');
    await says(request, 'Submitted');
    await request.getByRole('button', { name: requestCode }).click();
    const drawer = page.getByRole('dialog', { name: requestCode });
    await says(drawer, 'IL62 0108 0000 0009 9999 999');
    await drawer.getByRole('button', { name: 'Approve' }).click();
    await says(drawer.getByRole('status'), `Request ${requestCode}: Approved.`);
    await says(request, 'Approved');
    await drawer.getByRole('button', { name: 'Complete and move money' }).click();
    const complete = page.getByRole('dialog', { name: 'Complete request' });
    await says(complete, `Completing ${requestCode} records a $20.00 movement in the wallet of Jordan Journey.`);
    await complete.getByRole('button', { name: 'Complete and move money' }).click();
    await says(request, 'Completed');
    await drawer.getByRole('button', { name: 'Close' }).first().click();
    await signOut(page);
  });
});
