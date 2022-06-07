/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import type { PostgreSQL } from "@cocalc/database/postgres/types";
import { PurchaseInfo } from "@cocalc/util/licenses/purchase/types";
import { v4 as uuid } from "uuid";
import { getLogger } from "@cocalc/backend/logger";
import { getDedicatedDiskKey, PRICES } from "@cocalc/util/upgrades/dedicated";
import { Date0 } from "@cocalc/util/types/store";
const logger = getLogger("createLicense");

type DateRange = [Date0 | undefined, Date0 | undefined];

/**
 * We play nice to the user. if the start date is before the current time,
 * which happens when you order something that is supposed to start "now" (and is corrected to the start of the day in the user's time zone),
 * then append that period that's already in the past to the end of the range.
 */
function adjustRange([start, end]: DateRange): DateRange {
  if (start == null || end == null) {
    return [start, end];
  }
  const serverTime = new Date();
  if (start < serverTime) {
    const diff = serverTime.getTime() - start.getTime();
    end = new Date(end.getTime() + diff);
    // we don't care about changing fixedStart, because it's already in the past
  }
  return [start, end];
}

// ATTN: for specific intervals, the activates/expires start/end dates should be at the start/end of the day in the user's timezone.
// this is done while selecting the time interval – here, server side, we no longer know the user's time zone.
export default async function createLicense(
  database: PostgreSQL,
  account_id: string,
  info: PurchaseInfo
): Promise<string> {
  const license_id = await getUUID(database, info);
  logger.debug("creating a license...", license_id, info);

  const [start, end] =
    info.type !== "disk"
      ? adjustRange([info.start, info.end])
      : [info.start, undefined];

  const values: { [key: string]: any } = {
    "id::UUID": license_id,
    "info::JSONB": {
      purchased: { account_id, ...info },
    },
    "activates::TIMESTAMP":
      info.subscription != "no"
        ? new Date(new Date().valueOf() - 60000) // one minute in past to avoid any funny confusion.
        : start,
    "created::TIMESTAMP": new Date(),
    "managers::TEXT[]": [account_id],
    "quota::JSONB": await getQuota(info, license_id),
    "title::TEXT": info.title,
    "description::TEXT": info.description,
    "run_limit::INTEGER": info.quantity,
  };

  if (info.type !== "disk" && end != null) {
    values["expires::TIMESTAMP"] = end;
  }

  await database.async_query({
    query: "INSERT INTO site_licenses",
    values,
  });

  return license_id;
}

// this constructs the "quota" object for the license,
// while it also sanity checks all fields. Last chance to find a problem!
async function getQuota(info: PurchaseInfo, license_id: string) {
  switch (info.type) {
    case "quota":
      return {
        user: info.user,
        ram: info.custom_ram,
        cpu: info.custom_cpu,
        dedicated_ram: info.custom_dedicated_ram,
        dedicated_cpu: info.custom_dedicated_cpu,
        disk: info.custom_disk,
        always_running: info.custom_uptime === "always_running",
        idle_timeout: info.custom_uptime,
        member: info.custom_member,
        boost: info.boost ?? false,
      };

    case "vm":
      const { machine } = info.dedicated_vm;
      if (PRICES.vms[machine] == null) {
        throw new Error(`VM type ${machine} does not exist`);
      }
      return {
        dedicated_vm: {
          machine,
          name: uuid2name(license_id),
        },
      };

    case "disk":
      if (info.dedicated_disk === false) {
        throw new Error(`info.dedicated_disk cannot be false`);
      }
      const diskID = getDedicatedDiskKey(info.dedicated_disk);
      if (PRICES.disks[diskID] == null) {
        throw new Error(`Disk type ${diskID} does not exist`);
      }
      return {
        dedicated_disk: info.dedicated_disk,
      };
  }
}

const VM_NAME_EXISTS = `
SELECT EXISTS(
  SELECT 1 FROM site_licenses WHERE quota -> 'dedicated_vm' ->> 'name' = $1
) AS exists`;

async function getUUID(database: PostgreSQL, info: PurchaseInfo) {
  // in the case of type == 'vm', we derive the "name" from the UUID
  // and double check that this is a unique name.
  if (info.type !== "vm") return uuid();

  // we try up to 10 times
  for (let i = 0; i < 10; i++) {
    const id = uuid();
    // use the last part of the UUID id after the last dash
    const name = uuid2name(id);
    const res = await database.async_query({
      query: VM_NAME_EXISTS,
      params: [name],
    });
    if (res.rows[0]?.exists === false) {
      return id;
    }
  }
  throw new Error(`Unable to generate a unique name for VM`);
}

// last part of the UUID, we show this to users even if they're not license managers. hence no leak of information.
function uuid2name(id: string) {
  return id.split("-").pop();
}
