/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { getLogger } from "@cocalc/project/logger";
import * as message from "@cocalc/util/message";
import { NamedServerName } from "@cocalc/util/types/servers";
import { reuseInFlight } from "async-await-utils/hof";
import { start } from "./control";

const winston = getLogger("named-servers");

async function getPort(name: NamedServerName): Promise<number> {
  winston.debug(`getPort("${name}")`);
  return await start(name);
}

async function handleMessage(socket, mesg): Promise<void> {
  try {
    mesg.port = await getPort(mesg.name);
  } catch (err) {
    socket.write_mesg("json", message.error({ id: mesg.id, error: `${err}` }));
    return;
  }
  socket.write_mesg("json", mesg);
}

const handle = reuseInFlight(handleMessage, {
  createKey: (args) => `${args[1]?.name}`,
});
export default handle;
