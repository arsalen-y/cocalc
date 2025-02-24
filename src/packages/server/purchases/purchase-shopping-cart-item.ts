/*
Purchase one item of a shopping cart:

1. Create a license with the account_id as a manager.
2. Create an entry in the purchases table corresponding to this purchase, so it has the given cost, etc.
3. Mark this item of the shopping cart as purchased.

**Note that stripe is NOT involved in any way.**  Also, this is NOT concerned
with spending quotas or balances or anything.  This just allows any purchase.

This is used shopping-cart-checkout to actually create a license and items in the purchases
table corresponding to an item in a shopping cart, then mark that cart item as purchased.
This function is definitely not meant to be called directly via the api.


Here's what a typical shopping cart item looks like:

{
  "id": 4,
  "account_id": "8e138678-9264-431c-8dc6-5c4f6efe66d8",
  "added": "2023-06-24T19:25:57.139Z",
  "checked": true,
  "removed": null,
  "purchased": null,
  "product": "site-license",
  "description": {
    "type": "vm",
    "range": [
      "2023-06-29T07:00:00.000Z",
      "2023-07-04T06:59:59.999Z"
    ],
    "period": "range",
    "dedicated_vm": {
      "machine": "n2-highmem-8"
    }
  },
  "project_id": null,
  "cost": {
    "cost": 112.78032786885247,
    "cost_per_unit": 112.78032786885247,
    "discounted_cost": 112.78032786885247,
    "cost_per_project_per_month": 687.96,
    "cost_sub_month": 687.96,
    "cost_sub_year": 8255.52,
    "input": {
      "type": "vm",
      "range": [
        "2023-06-29T07:00:00.000Z",
        "2023-07-04T06:59:59.999Z"
      ],
      "period": "range",
      "dedicated_vm": {
        "machine": "n2-highmem-8"
      },
      "subscription": "no",
      "start": "2023-06-29T07:00:00.000Z",
      "end": "2023-07-04T06:59:59.999Z"
    },
    "period": "range"
  }
}
*/

import getPool, { PoolClient } from "@cocalc/database/pool";
import createPurchase from "@cocalc/server/purchases/create-purchase";
import getPurchaseInfo from "@cocalc/util/licenses/purchase/purchase-info";
import { sanity_checks } from "@cocalc/util/licenses/purchase/sanity-checks";
import createLicense from "@cocalc/server/licenses/purchase/create-license";
import isValidAccount from "@cocalc/server/accounts/is-valid-account";
import { restartProjectIfRunning } from "@cocalc/server/projects/control/util";
import getLogger from "@cocalc/backend/logger";
import createSubscription from "./create-subscription";
import addLicenseToProject from "@cocalc/server/licenses/add-to-project";
import { getClosingDay } from "./closing-date";
import { compute_cost } from "@cocalc/util/licenses/purchase/compute-cost";
import dayjs from "dayjs";

const logger = getLogger("purchases:purchase-shopping-cart-item");

export default async function purchaseShoppingCartItem(
  item,
  client: PoolClient
) {
  logger.debug("purchaseShoppingCartItem", item);
  if (item.product != "site-license") {
    // This *ONLY* implements purchasing the site-license product, which is the only
    // one we have right now.
    throw Error("only the 'site-license' product is currently implemented");
  }

  // just a little sanity check.
  if (!(await isValidAccount(item?.account_id))) {
    throw Error(`invalid account_id - ${item.account_id}`);
  }

  const { license_id, info, licenseCost } =
    await createLicenseFromShoppingCartItem(item, client);
  logger.debug(
    "purchaseShoppingCartItem -- created license from shopping cart item",
    license_id,
    item,
    info
  );

  const purchase_id = await createPurchase({
    account_id: item.account_id,
    cost: licenseCost.discounted_cost,
    service: "license",
    description: { type: "license", item, info, license_id },
    tag: "license-purchase",
    period_start: info.start,
    period_end: info.end,
    client,
  });
  logger.debug(
    "purchaseShoppingCartItem -- created purchase from shopping cart item",
    { purchase_id, license_id, item_id: item.id }
  );

  if (item.description.period != "range") {
    let interval = item.description.period;
    if (interval.endsWith("ly")) {
      interval = interval.slice(0, -2); // get rid of the ly
    }
    const subscription_id = await createSubscription(
      {
        account_id: item.account_id,
        cost: item.cost.discounted_cost,
        interval,
        current_period_start: dayjs(info.end).subtract(1, interval).toDate(), // since info.end might have changed.
        current_period_end: info.end,
        latest_purchase_id: purchase_id,
        status: "active",
        metadata: { type: "license", license_id },
      },
      client
    );
    logger.debug(
      "purchaseShoppingCartItem -- created subscription from shopping cart item",
      { subscription_id, license_id, item_id: item.id }
    );
  }

  await markItemPurchased(item, license_id, client);
  logger.debug("moved shopping cart item to purchased.");
}

export async function createLicenseFromShoppingCartItem(
  item,
  client: PoolClient
): Promise<{ license_id: string; info; licenseCost }> {
  const info = getPurchaseInfo(item.description);
  let licenseCost = item.cost;

  if (info.type != "vouchers" && item.description.period != "range") {
    let end = info.end;
    // adjust end day to match user's closing day, since it's very nice for all the subscriptions
    // to renew on the same day as the statement, so user's get one single bill rather than a mess.
    const closingDay = await getClosingDay(item.account_id);
    // the end > start+1 condition is to avoid any potential of an infinite loop, e.g., if closingDay
    // were somehow corrupted.
    while (end.getDate() != closingDay && end > info.start) {
      end = dayjs(end).subtract(1, "day").toDate();
    }
    if (!dayjs(end).isSame(dayjs(info.end))) {
      // Regarding cost -- because of adjusting end above, we prorate first month/year cost
      const newCost = compute_cost({ ...info, end, subscription: "no" });
      if (newCost.discounted_cost < licenseCost.discounted_cost) {
        licenseCost = newCost;
      }
      info.end = end;
    }
  }

  logger.debug("running sanity checks on license...");
  const pool = client ?? getPool();
  await sanity_checks(pool, info);
  const license_id = await createLicense(item.account_id, info, pool);
  if (item.project_id) {
    addLicenseToProjectAndRestart(item.project_id, license_id, client);
  }
  return { info, license_id, licenseCost };
}

async function markItemPurchased(item, license_id: string, client: PoolClient) {
  const pool = client ?? getPool();
  await pool.query(
    "UPDATE shopping_cart_items SET purchased=$3 WHERE account_id=$1 AND id=$2",
    [item.account_id, item.id, { success: true, time: new Date(), license_id }]
  );
}

export async function addLicenseToProjectAndRestart(
  project_id: string,
  license_id: string,
  client: PoolClient
) {
  try {
    await addLicenseToProject({ project_id, license_id, client });
    await restartProjectIfRunning(project_id);
  } catch (err) {
    // non-fatal, since it's just a convenience.
    logger.debug("WARNING -- issue adding license to project ", err);
  }
}
