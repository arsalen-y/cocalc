import { FieldSpec, Table } from "./types";
export const MAX_TAG_LENGTH = 30;

const TAG_TYPE = `VARCHAR(${MAX_TAG_LENGTH})[]`;

const TAGS_FIELD = {
  type: "array",
  pg_type: TAG_TYPE,
  desc: "Tags applied to this record.",
  render: { type: "tags", editable: true },
} as FieldSpec;

export const PRIORITIES = ["low", "normal", "high", "urgent"];
const PRIORITY_TYPE = `VARCHAR(${MAX_TAG_LENGTH})`;
const PRORITIES_FIELD = {
  type: "string",
  pg_type: PRIORITY_TYPE,
  desc: "Priority of this record: " + PRIORITIES.join(" "),
  render: { type: "priority", editable: true },
} as FieldSpec;

export const STATUSES = ["new", "open", "active", "pending", "solved"];
const STATUS_TYPE = `VARCHAR(${MAX_TAG_LENGTH})`;
const STATUS_FIELD = {
  type: "string",
  pg_type: STATUS_TYPE,
  desc: "Status of this record: " + STATUSES.join(" "),
  render: { type: "status", editable: true },
} as FieldSpec;

Table({
  name: "crm_people",
  fields: {
    id: {
      type: "integer",
      desc: "Automatically generated sequential id that uniquely determines this person.",
      pg_type: "SERIAL UNIQUE",
      noCoerce: true,
    },
    created: {
      type: "timestamp",
      desc: "When the person was created.",
    },
    last_edited: {
      type: "timestamp",
      desc: "When this person was last edited.",
    },
    name: {
      type: "string",
      pg_type: "VARCHAR(254)",
      desc: "The name of this person.",
      render: {
        type: "text",
        maxLen: 254,
        editable: true,
      },
    },
    email_addresses: {
      type: "array",
      pg_type: "VARCHAR(1000)",
      desc: "Email addresses for this person, separated by commas",
      render: {
        type: "text",
        maxLen: 1000,
        editable: true,
      },
    },
    account_ids: {
      title: "Accounts",
      type: "array",
      pg_type: "UUID[]",
      desc: "Array of 0 or more CoCalc accounts that this person may have.",
      render: {
        type: "accounts",
        editable: true,
      },
    },
    deleted: {
      type: "boolean",
      desc: "True if the person has been deleted.",
    },
    notes: {
      type: "string",
      desc: "Open ended text in markdown about this person.",
      render: { type: "markdown", editable: true },
    },
    // https://stackoverflow.com/questions/13837258/what-is-an-appropriate-data-type-to-store-a-timezone
    timezone: {
      type: "string",
      desc: "The person's time zone, e.g., 'Europe/Paris' or 'US/Pacific'.",
      render: {
        type: "text",
        maxLen: 254,
        editable: true,
      },
    },
    tags: TAGS_FIELD,
  },
  rules: {
    desc: "People",
    primary_key: "id",
    user_query: {
      get: {
        pg_where: [],
        admin: true,
        fields: {
          id: null,
          created: null,
          last_edited: null,
          email_addresses: null,
          name: null,
          account_ids: null,
          deleted: null,
          notes: null,
          tags: null,
        },
        options: [{ limit: 100 }],
      },
      set: {
        admin: true,
        fields: {
          id: true,
          created: true,
          last_edited: true,
          name: true,
          email_addresses: true,
          account_ids: true,
          deleted: true,
          notes: true,
          tags: null,
        },
        required_fields: {
          last_edited: true, // TODO: make automatic on any set query
        },
      },
    },
  },
});

// TODO: add image -- probably want to use blob table (?) but maybe do like with projects. Not sure.
Table({
  name: "crm_organizations",
  fields: {
    id: {
      type: "integer",
      desc: "Automatically generated sequential id that uniquely determines this organization.",
      pg_type: "SERIAL UNIQUE",
      noCoerce: true,
    },
    created: {
      type: "timestamp",
      desc: "When the organization was created.",
    },
    last_edited: {
      type: "timestamp",
      desc: "When this person was last edited.",
    },
    name: {
      type: "string",
      pg_type: "VARCHAR(254)",
      desc: "The name of this organization.",
      render: {
        type: "text",
        maxLen: 254,
        editable: true,
      },
    },
    people_ids: {
      type: "array",
      pg_type: "UUID[]",
      desc: "Array of 0 or more people that are connected with this organization",
    },
    organization_ids: {
      type: "array",
      pg_type: "UUID[]",
      desc: "Array of 0 or more organization that are connected with this organization",
    },
    deleted: {
      type: "boolean",
      desc: "True if this org has been deleted.",
    },
    notes: {
      type: "string",
      desc: "Open ended text in markdown about this organization.",
      render: {
        type: "markdown",
        editable: true,
      },
    },
    timezone: {
      type: "string",
      desc: "The organizations's time zone, e.g., 'Europe/Paris' or 'US/Pacific'.",
      render: {
        type: "text",
        editable: true,
      },
    },
    domain: {
      type: "string",
      pg_type: "VARCHAR(254)", // todo -- should this be an array of domain names?
      desc: "Domain name of this org, e.g., math.washington.edu.",
      render: {
        type: "text",
        editable: true,
        maxLen: 254,
      },
    },
    tags: TAGS_FIELD,
  },
  rules: {
    desc: "Organizations",
    primary_key: "id",
    user_query: {
      get: {
        pg_where: [],
        admin: true,
        fields: {
          id: null,
          created: null,
          last_edited: null,
          name: null,
          people_ids: null,
          organization_ids: null,
          deleted: null,
          notes: null,
          domain: null,
          tags: null,
        },
        options: [{ limit: 100 }],
      },
      set: {
        admin: true,
        fields: {
          id: true,
          created: true,
          last_edited: true,
          name: true,
          people_ids: true,
          organization_ids: true,
          deleted: true,
          notes: true,
          domain: true,
          tags: true,
        },
        required_fields: {
          last_edited: true, // TODO: make automatic on any set query
        },
      },
    },
  },
});

Table({
  name: "crm_support_tickets",
  fields: {
    id: {
      type: "integer",
      desc: "Automatically generated sequential id that uniquely determines this support ticket.",
      pg_type: "SERIAL UNIQUE",
      noCoerce: true,
    },
    subject: {
      type: "string",
      pg_type: "VARCHAR(254)",
      desc: "Subject of the message. Must be short.",
      render: {
        type: "text",
        maxLen: 254,
        editable: true,
      },
    },
    created: {
      type: "timestamp",
      desc: "When the support ticket was created.",
    },
    last_edited: {
      type: "timestamp",
      desc: "When this ticket was last changed in some way.",
    },
    created_by: {
      type: "integer",
      desc: "Id of the person who created this ticket.",
    },
    assignee: {
      type: "uuid",
      desc: "Account that is responsible for resolving this ticket.",
    },
    cc: {
      type: "array",
      pg_type: "UUID[]",
      desc: "Zero or more support accounts that care to be contacted about updates to this ticket.",
    },
    tags: TAGS_FIELD,
    priority: PRORITIES_FIELD,
    status: STATUS_FIELD,
    type: {
      type: "string",
      pg_type: `VARCHAR(${MAX_TAG_LENGTH})`,
      desc: "The type of this ticket: question, incident, problem, task, etc.",
      render: { type: "text", editable: true },
    },
  },
  rules: {
    desc: "Support Tickets",
    primary_key: "id",
    user_query: {
      get: {
        pg_where: [],
        admin: true,
        fields: {
          id: null,
          subject: null,
          created: null,
          created_by: null,
          last_edited: null,
          assignee: null,
          cc: null,
          tags: null,
          type: null,
          priority: null,
          status: null,
        },
        options: [{ limit: 100 }],
      },
      set: {
        admin: true,
        fields: {
          id: true,
          subject: true,
          created: true,
          last_edited: true,
          created_by: null,
          assignee: true,
          cc: true,
          tags: true,
          type: true,
          priority: true,
          status: true,
        },
        required_fields: {
          last_edited: true, // TODO: make automatic on any set query
        },
      },
    },
  },
});

Table({
  name: "crm_support_messages",
  fields: {
    id: {
      type: "integer",
      desc: "Automatically generated sequential id that uniquely determines this message.",
      pg_type: "SERIAL UNIQUE",
      noCoerce: true,
    },
    ticket_id: {
      type: "integer",
      desc: "Support ticket id that this message is connected to.",
    },
    created: {
      type: "timestamp",
      desc: "When the message was created.  (We may save periodically before actually marking it sent.)",
    },
    last_edited: {
      type: "timestamp",
      desc: "When this message was actually sent.",
    },
    from_person_id: {
      type: "integer",
      desc: "Person that sent this message.  This in the crm_people table, not a cocalc account.",
    },
    body: {
      type: "string",
      desc: "Actual content of the message.  This is interpretted as markdown.",
      render: {
        type: "markdown",
        editable: true,
        maxLen: 20000,
      },
    },
    internal: {
      type: "boolean",
      desc: "If true, the message is internal and only visible to support staff.",
      render: {
        type: "boolean",
        editable: true,
      },
    },
  },
  rules: {
    desc: "Support Messages",
    primary_key: "id",
    user_query: {
      get: {
        pg_where: [],
        admin: true,
        fields: {
          id: null,
          ticket_id: null,
          created: null,
          last_edited: null,
          from_person_id: null,
          body: null,
          internal: null,
        },
        options: [{ limit: 100 }],
      },
      set: {
        admin: true,
        fields: {
          id: true,
          ticket_id: null,
          created: true,
          last_edited: true,
          from_person_id: true,
          body: true,
          internal: true,
        },
        required_fields: {
          last_edited: true, // TODO: make automatic on any set query
        },
      },
    },
  },
});

Table({
  name: "crm_tasks",
  fields: {
    id: {
      type: "integer",
      desc: "Automatically generated sequential id that uniquely determines this task.",
      pg_type: "SERIAL UNIQUE",
      noCoerce: true,
    },
    subject: {
      type: "string",
      pg_type: "VARCHAR(254)",
      desc: "Short summary of this tasks.",
      render: {
        type: "text",
        maxLen: 254,
        editable: true,
      },
    },
    due_date: {
      title: "Due",
      type: "timestamp",
      desc: "When this task is due.",
      render: {
        type: "timestamp",
        editable: true,
      },
    },
    created: {
      type: "timestamp",
      desc: "When the task was created.",
      render: {
        type: "timestamp",
        editable: false,
      },
    },
    closed: {
      type: "timestamp",
      title: "When closed",
      desc: "When the task was marked as done.",
      render: {
        type: "timestamp",
        editable: false,
      },
    },
    done: {
      type: "boolean",
      desc: "The task is done.",
      render: {
        type: "boolean",
        editable: true,
        whenField: "closed",
      },
    },
    last_edited: {
      type: "timestamp",
      desc: "When this task was last modified.",
    },
    status: STATUS_FIELD,
    progress: {
      type: "integer",
      desc: "Progress on this task, as a number from 0 to 100.",
      render: {
        type: "percent",
        editable: true,
        steps: 5,
      },
    },
    priority: PRORITIES_FIELD,
    related_to: {
      type: "map",
      desc: "Object {table:'...', id:number} describing one organization, deal,  lead, etc. that this tasks is related to.",
    },
    person_id: {
      type: "integer",
      desc: "Person that this tasks is connected with.",
    },
    created_by: {
      type: "uuid",
      desc: "Account that created this task.",
    },
    last_modified_by: {
      type: "uuid",
      desc: "Account that last modified this task.",
    },
    assignee: {
      type: "array",
      pg_type: "UUID",
      desc: "Accounts that will resolve this task.",
    },
    cc: {
      type: "array",
      pg_type: "UUID[]",
      desc: "Zero or more accounts that care to be contacted/notified about updates to this task.",
    },
    tags: TAGS_FIELD,
    description: {
      type: "string",
      desc: "Full markdown task description",
      render: {
        type: "markdown",
        editable: true,
      },
    },
  },
  rules: {
    desc: "Tasks",
    primary_key: "id",
    user_query: {
      get: {
        pg_where: [],
        admin: true,
        fields: {
          id: null,
          subject: null,
          due_date: null,
          created: null,
          done: null,
          closed: null,
          last_edited: null,
          status: null,
          progress: null,
          priority: null,
          related_to: null,
          person_id: null,
          created_by: null,
          last_modified_by: null,
          assignee: null,
          cc: null,
          tags: null,
          description: null,
        },
        options: [{ limit: 100 }],
      },
      set: {
        admin: true,
        fields: {
          id: true,
          subject: true,
          due_date: true,
          created: true,
          done: true,
          closed: true,
          last_edited: true,
          status: true,
          progress: true,
          priority: true,
          related_to: true,
          person_id: true,
          created_by: true,
          last_modified_by: true,
          assignee: true,
          cc: true,
          tags: true,
          description: true,
        },
        required_fields: {
          last_edited: true, // TODO: make automatic on any set query
        },
      },
    },
  },
});
