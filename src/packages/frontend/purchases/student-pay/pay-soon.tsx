import { Button, Collapse } from "antd";
import type { PurchaseInfo } from "@cocalc/util/licenses/purchase/types";
import dayjs from "dayjs";
import { Icon, TimeAgo } from "@cocalc/frontend/components";
import { useState } from "react";
import Cost from "./cost";

interface Props {
  when: dayjs.Dayjs;
  purchaseInfo: PurchaseInfo;
  setOpen: (open: boolean) => void;
}

export default function PaySoon({ when, purchaseInfo, setOpen }: Props) {
  const [hide, setHide] = useState<boolean>(false);
  if (hide) {
    return null;
  }
  return (
    <div style={{ margin: "0 2.5px" }}>
      <Collapse>
        <Collapse.Panel
          key="it"
          header=<>
            Course Fee: Please pay the course fee{" "}
            <Cost purchaseInfo={purchaseInfo} /> to upgrade this project.{" "}
            <b>
              Due: <TimeAgo date={when} />.
            </b>
            <Button
              size="small"
              style={{ float: "right", fontSize: "9pt" }}
              onClick={() => setHide(true)}
            >
              <Icon name="times" /> Dismiss
            </Button>{" "}
          </>
        >
          <div style={{ textAlign: "center" }}>
            <Button
              size="large"
              type="primary"
              onClick={() => {
                setOpen(true);
              }}
            >
              <Icon name='credit-card'/> Pay Course Fee...
            </Button>
          </div>
        </Collapse.Panel>
      </Collapse>
    </div>
  );
}
