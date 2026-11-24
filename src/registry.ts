export interface FlagSpec {
	name: string;
	help: string;
	/** The command fails with a usage error without this flag. */
	required?: boolean;
	repeatable?: boolean;
	values?: readonly string[];
	query?: string;
	body?: string;
	bodyBoolean?: boolean;
	integer?: boolean;
	boolean?: boolean;
}

export interface ArgSpec {
	name: string;
	kind: "integer" | "string";
	param: string;
}

export interface CommandSpec {
	id: string;
	words: readonly string[];
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string;
	args: readonly ArgSpec[];
	flags: readonly FlagSpec[];
	dateRange?: "required";
	paginated?: "activity" | "webhook";
	scope: "read" | "write" | "none";
	confirm?: string;
	auth: boolean;
	summary?: "me" | "status" | "setup" | "list";
	summaryKey?: string;
	rawBody?: boolean;
	secretOnce?: boolean;
	help: string;
}

const ACTIVITY_LIMIT =
	"Page size. Default 100, max 500. Omitted unless you pass it.";
const WEBHOOK_LIMIT =
	"Page size. Default 25, max 100. Omitted unless you pass it.";

/**
 * The only command list. Help, the flag allowlist, and request building
 * are derived from this table.
 */
export const REGISTRY = [
	cmd({
		id: "openapi",
		words: ["openapi"],
		method: "GET",
		path: "/openapi.yaml",
		args: [],
		flags: [
			{
				name: "format",
				help: "Document format. Default yaml.",
				values: ["yaml", "json"],
			},
		],
		scope: "none",
		auth: false,
		rawBody: true,
		help: "Print the OpenAPI document. No API key required.",
	}),
	cmd({
		id: "me",
		words: ["me"],
		method: "GET",
		path: "/me",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "me",
		help: "Show the account, API key, and connections for this key.",
	}),
	cmd({
		id: "account.status",
		words: ["account", "status"],
		method: "GET",
		path: "/account/status",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "status",
		help: "Show whether this account is ready to sync, with blockers.",
	}),
	cmd({
		id: "account.metrics",
		words: ["account", "metrics"],
		method: "GET",
		path: "/account/metrics",
		args: [],
		flags: [
			integerQuery("connection-id", "connectionId", "Count one connection."),
			integerQuery("source-id", "sourceId", "Count one source. Does not filter destination deliveries."),
		],
		dateRange: "required",
		scope: "read",
		auth: true,
		help: "Count requests, syncs, and destination deliveries in a date range.",
	}),
	cmd({
		id: "setup",
		words: ["setup"],
		method: "GET",
		path: "/setup",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "setup",
		help: "Show the setup wizard for this key.",
	}),
	cmd({
		id: "connections.list",
		words: ["connections", "list"],
		method: "GET",
		path: "/connections",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "connections",
		help: "List CRM connections visible to this key.",
	}),
	cmd({
		id: "sources.list",
		words: ["sources", "list"],
		method: "GET",
		path: "/sources",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "sources",
		help: "List webhook sources and their config.",
	}),
	cmd({
		id: "sources.requests",
		words: ["sources", "requests"],
		method: "GET",
		path: "/sources/{sourceId}/requests",
		args: [integerArg("sourceId")],
		flags: [],
		dateRange: "required",
		paginated: "activity",
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "data",
		help: "List webhook requests received by one source.",
	}),
	cmd({
		id: "sources.syncs",
		words: ["sources", "syncs"],
		method: "GET",
		path: "/sources/{sourceId}/syncs",
		args: [integerArg("sourceId")],
		flags: [
			enumQuery("status", "status", ["success", "warning", "error"], "Filter by sync status."),
			integerQuery("connection-id", "connectionId", "Filter by connection."),
		],
		dateRange: "required",
		paginated: "activity",
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "data",
		help: "List CRM syncs for one source.",
	}),
	cmd({
		id: "sources.retry-syncs",
		words: ["sources", "retry-syncs"],
		method: "POST",
		path: "/sources/{sourceId}/syncs/retry",
		args: [integerArg("sourceId")],
		flags: [],
		scope: "write",
		auth: true,
		confirm:
			"Re-queues every recorded error from the last 30 days for this source, once per source per 24 hours. Re-run with --yes.",
		help: "Bulk-retry failed HubSpot and Salesforce syncs for one source. Requires --yes and the write scope.",
	}),
	cmd({
		id: "contacts.outreach",
		words: ["contacts", "outreach"],
		method: "GET",
		path: "/contacts/outreach",
		args: [],
		flags: [
			{
				name: "email",
				help: "One email address.",
				query: "email",
			},
			{
				name: "profile-url",
				help: "LinkedIn (/in/ or /pub/) or X profile URL. Repeat up to 5 times.",
				query: "profileUrl",
				repeatable: true,
			},
			{
				name: "file",
				help: "JSONL or CSV file of contacts. Use - to read stdin.",
			},
		],
		scope: "read",
		auth: true,
		help: "Look up whether a contact was outreached. Pass --email, --profile-url, or --file.",
	}),
	cmd({
		id: "requests.list",
		words: ["requests", "list"],
		method: "GET",
		path: "/requests",
		args: [],
		flags: [integerQuery("source-id", "sourceId", "Filter by source.")],
		dateRange: "required",
		paginated: "activity",
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "data",
		help: "List webhook requests in a date range.",
	}),
	cmd({
		id: "requests.metrics",
		words: ["requests", "metrics"],
		method: "GET",
		path: "/requests/metrics",
		args: [],
		flags: [integerQuery("source-id", "sourceId", "Count one source.")],
		dateRange: "required",
		scope: "read",
		auth: true,
		help: "Count webhook requests in a date range.",
	}),
	cmd({
		id: "syncs.list",
		words: ["syncs", "list"],
		method: "GET",
		path: "/syncs",
		args: [],
		flags: [
			enumQuery("status", "status", ["success", "warning", "error"], "Filter by sync status."),
			integerQuery("source-id", "sourceId", "Filter by source."),
			integerQuery("connection-id", "connectionId", "Filter by connection."),
		],
		dateRange: "required",
		paginated: "activity",
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "data",
		help: "List CRM syncs in a date range.",
	}),
	cmd({
		id: "syncs.get",
		words: ["syncs", "get"],
		method: "GET",
		path: "/syncs/{id}",
		args: [integerArg("id")],
		flags: [],
		scope: "read",
		auth: true,
		help: "Show one CRM sync, including its error.",
	}),
	cmd({
		id: "syncs.metrics",
		words: ["syncs", "metrics"],
		method: "GET",
		path: "/syncs/metrics",
		args: [],
		flags: [
			integerQuery("source-id", "sourceId", "Count one source."),
			integerQuery("connection-id", "connectionId", "Count one connection."),
		],
		dateRange: "required",
		scope: "read",
		auth: true,
		help: "Count CRM syncs in a date range.",
	}),
	cmd({
		id: "syncs.retry",
		words: ["syncs", "retry"],
		method: "POST",
		path: "/syncs/{id}/retry",
		args: [integerArg("id")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Re-queues this failed sync to the CRM. Re-run with --yes.",
		help: "Re-queue one failed HubSpot or Salesforce sync. Requires --yes and the write scope.",
	}),
	cmd({
		id: "destinations.list",
		words: ["destinations", "list"],
		method: "GET",
		path: "/destinations",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "destinations",
		help: "List outbound destinations.",
	}),
	cmd({
		id: "destinations.get",
		words: ["destinations", "get"],
		method: "GET",
		path: "/destinations/{id}",
		args: [integerArg("id")],
		flags: [],
		scope: "read",
		auth: true,
		help: "Show one destination.",
	}),
	cmd({
		id: "destinations.reply-relays",
		words: ["destinations", "reply-relays"],
		method: "GET",
		path: "/destinations/reply-relays",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "replyRelays",
		help: "List reply-relay destinations.",
	}),
	cmd({
		id: "destinations.deliveries",
		words: ["destinations", "deliveries"],
		method: "GET",
		path: "/destinations/{id}/deliveries",
		args: [integerArg("id")],
		flags: [enumQuery("status", "status", ["success", "error"], "Filter by delivery status.")],
		dateRange: "required",
		paginated: "activity",
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "data",
		help: "List deliveries for one destination.",
	}),
	cmd({
		id: "destinations.delivery-metrics",
		words: ["destinations", "delivery-metrics"],
		method: "GET",
		path: "/destinations/{id}/deliveries/metrics",
		args: [integerArg("id")],
		flags: [],
		dateRange: "required",
		scope: "read",
		auth: true,
		help: "Count deliveries for one destination.",
	}),
	cmd({
		id: "destinations.replay",
		words: ["destinations", "replay"],
		method: "POST",
		path: "/destinations/{id}/deliveries/{deliveryId}/replay",
		args: [integerArg("id"), integerArg("deliveryId")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Queues this delivery's payload to be sent to the destination URL again. Re-run with --yes.",
		help: "Replay one destination delivery. Requires --yes and the write scope.",
	}),
	cmd({
		id: "deliveries.list",
		words: ["deliveries", "list"],
		method: "GET",
		path: "/deliveries",
		args: [],
		flags: [
			enumQuery("status", "status", ["success", "error"], "Filter by delivery status."),
			integerQuery("destination-id", "destinationId", "Filter by destination."),
		],
		dateRange: "required",
		paginated: "activity",
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "data",
		help: "List destination deliveries in a date range.",
	}),
	cmd({
		id: "blocklists.list",
		words: ["blocklists", "list"],
		method: "GET",
		path: "/blocklists",
		args: [],
		flags: [integerQuery("connection-id", "connectionId", "Filter by connection.")],
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "blocklists",
		help: "List block lists.",
	}),
	cmd({
		id: "blocklists.pause",
		words: ["blocklists", "pause"],
		method: "POST",
		path: "/blocklists/{id}/pause",
		args: [integerArg("id")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Stops fetching and pushing this block list. It does not clear the list in the sequencer. Re-run with --yes.",
		help: "Pause one block list. Requires --yes and the write scope.",
	}),
	cmd({
		id: "blocklists.resync",
		words: ["blocklists", "resync"],
		method: "POST",
		path: "/blocklists/{id}/resync",
		args: [integerArg("id")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Enables this block list and queues a full reload from the CRM. Re-run with --yes.",
		help: "Reload one block list from the CRM. Requires --yes and the write scope.",
	}),
	cmd({
		id: "webhooks.list",
		words: ["webhooks", "list"],
		method: "GET",
		path: "/webhooks",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "webhooks",
		help: "List platform webhook endpoints. Requires an account-scoped key.",
	}),
	cmd({
		id: "webhooks.get",
		words: ["webhooks", "get"],
		method: "GET",
		path: "/webhooks/{id}",
		args: [stringArg("id")],
		flags: [],
		scope: "read",
		auth: true,
		help: "Show one platform webhook endpoint. Requires an account-scoped key.",
	}),
	cmd({
		id: "webhooks.create",
		words: ["webhooks", "create"],
		method: "POST",
		path: "/webhooks",
		args: [],
		flags: [
			{ name: "url", help: "https endpoint that will receive events.", body: "url", required: true },
			{ name: "description", help: "Optional label, at most 500 characters.", body: "description" },
			{
				name: "event",
				help: "Event type to enable. Repeat to set the list. Omit to enable every event.",
				body: "enabledEvents",
				repeatable: true,
			},
		],
		scope: "write",
		auth: true,
		confirm: "Registers this URL to receive OutboundSync platform events. Re-run with --yes.",
		secretOnce: true,
		help: "Create a platform webhook endpoint. The signing secret is printed once. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "webhooks.update",
		words: ["webhooks", "update"],
		method: "PATCH",
		path: "/webhooks/{id}",
		args: [stringArg("id")],
		flags: [
			{ name: "url", help: "Replacement https endpoint.", body: "url" },
			{ name: "description", help: "Replacement label, at most 500 characters.", body: "description" },
			{
				name: "event",
				help: "Replacement event type. Repeat to replace the list.",
				body: "enabledEvents",
				repeatable: true,
			},
			{
				name: "active",
				help: "true to enable the endpoint, false to disable it.",
				body: "isActive",
				bodyBoolean: true,
				values: ["true", "false"],
			},
		],
		scope: "write",
		auth: true,
		confirm: "Changes this webhook's URL, events, label, or active state. Re-run with --yes.",
		help: "Update a platform webhook endpoint. Pass at least one field. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "webhooks.delete",
		words: ["webhooks", "delete"],
		method: "DELETE",
		path: "/webhooks/{id}",
		args: [stringArg("id")],
		flags: [],
		scope: "write",
		auth: true,
		confirm:
			"Soft-deletes this webhook. It stops receiving deliveries and cannot be restored through the API. Re-run with --yes.",
		help: "Soft-delete a platform webhook endpoint. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "webhooks.rotate-secret",
		words: ["webhooks", "rotate-secret"],
		method: "POST",
		path: "/webhooks/{id}/rotate-secret",
		args: [stringArg("id")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Replaces the signing secret. The previous secret stops working. Re-run with --yes.",
		secretOnce: true,
		help: "Rotate a webhook signing secret. The new secret is printed once. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "webhooks.test",
		words: ["webhooks", "test"],
		method: "POST",
		path: "/webhooks/{id}/test",
		args: [stringArg("id")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Queues a test.ping delivery to this webhook's URL. Re-run with --yes.",
		help: "Queue a test.ping delivery to one platform webhook. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "webhooks.deliveries",
		words: ["webhooks", "deliveries"],
		method: "GET",
		path: "/webhooks/{id}/deliveries",
		args: [stringArg("id")],
		flags: [
			enumQuery("status", "status", ["PENDING", "SUCCEEDED", "FAILED", "DEAD"], "Filter by delivery status."),
		],
		paginated: "webhook",
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "data",
		help: "List delivery attempts for one platform webhook. Requires an account-scoped key.",
	}),
	cmd({
		id: "webhooks.replay",
		words: ["webhooks", "replay"],
		method: "POST",
		path: "/webhooks/{id}/deliveries/{deliveryId}/replay",
		args: [stringArg("id"), stringArg("deliveryId")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Queues a new delivery of this event to the webhook's URL. Re-run with --yes.",
		help: "Replay one platform webhook delivery. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "events.list",
		words: ["events", "list"],
		method: "GET",
		path: "/events",
		args: [],
		flags: [
			{
				name: "type",
				help: "Event type. Repeat to include more than one.",
				query: "type",
				repeatable: true,
			},
			enumQuery("delivered", "delivered", ["true", "false"], "true for events with at least one successful delivery, false for the rest."),
		],
		paginated: "webhook",
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "data",
		help: "List platform events. Connection-scoped keys see their connection's events plus account-level events.",
	}),
	cmd({
		id: "events.get",
		words: ["events", "get"],
		method: "GET",
		path: "/events/{id}",
		args: [stringArg("id")],
		flags: [],
		scope: "read",
		auth: true,
		help: "Show one platform event and its deliveries. Connection-scoped keys see their connection's events plus account-level events.",
	}),
	cmd({
		id: "workspace.get",
		words: ["workspace", "get"],
		method: "GET",
		path: "/workspace",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		help: "Show the workspace for this key, the owner's role, and that role's permissions. A legacy key is rejected.",
	}),
	cmd({
		id: "workspace.update",
		words: ["workspace", "update"],
		method: "PATCH",
		path: "/workspace",
		args: [],
		flags: [
			{
				name: "name",
				help: 'New name. Blank is rejected, "Create new workspace" is reserved, and more than 80 characters is rejected.',
				body: "name",
				required: true,
			},
		],
		scope: "write",
		auth: true,
		confirm:
			'Renames the workspace. A blank name, a name longer than 80 characters, or the reserved name "Create new workspace" is rejected. Re-run with --yes.',
		help: "Rename the workspace. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "workspace.domains",
		words: ["workspace", "domains"],
		method: "GET",
		path: "/workspace/domains",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "domains",
		help: "List email domains that can see this workspace. Requires an account-scoped key.",
	}),
	cmd({
		id: "workspace.domains.create",
		words: ["workspace", "domains", "create"],
		method: "POST",
		path: "/workspace/domains",
		args: [],
		flags: [
			{
				name: "domain",
				help: "Registrable domain, such as acme.com. Stored only when the key owner's email is on it.",
				body: "domain",
				required: true,
			},
		],
		scope: "write",
		auth: true,
		confirm:
			"Allows this email domain to see the workspace. It is stored only when the key owner's email is on that domain. Re-run with --yes.",
		help: "Allow an email domain for this workspace. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "workspace.domains.update",
		words: ["workspace", "domains", "update"],
		method: "PATCH",
		path: "/workspace/domains/{domain}",
		args: [stringArg("domain")],
		flags: [
			{
				name: "discoverable",
				help: "true to let people on the domain find the workspace, false to hide it. false also turns auto-join off.",
				body: "discoverable",
				bodyBoolean: true,
				values: ["true", "false"],
			},
			{
				name: "auto-join-enabled",
				help: "true to let people on the domain join as Members. An unverified domain cannot turn this on.",
				body: "autoJoinEnabled",
				bodyBoolean: true,
				values: ["true", "false"],
			},
		],
		scope: "write",
		auth: true,
		confirm: "Changes whether this domain is discoverable or lets people on it join as Members. Re-run with --yes.",
		help: "Change who on a domain can find or join the workspace. Pass at least one flag. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "workspace.domains.delete",
		words: ["workspace", "domains", "delete"],
		method: "DELETE",
		path: "/workspace/domains/{domain}",
		args: [stringArg("domain")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Removes this email domain from the workspace. People who already belong stay members. Re-run with --yes.",
		help: "Remove an allowed email domain. Existing members stay. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "workspace.invitations",
		words: ["workspace", "invitations"],
		method: "GET",
		path: "/workspace/invitations",
		args: [],
		flags: [
			enumQuery(
				"status",
				"status",
				["open", "pending", "expired", "accepted", "revoked", "all"],
				"Which invitations to return. Default open (pending and expired). all includes accepted and revoked.",
			),
		],
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "invitations",
		help: "List invitations that still need someone to act. Requires an account-scoped key.",
	}),
	cmd({
		id: "workspace.invitations.create",
		words: ["workspace", "invitations", "create"],
		method: "POST",
		path: "/workspace/invitations",
		args: [],
		flags: [
			{
				name: "email",
				help: "Address that receives the invitation.",
				body: "email",
				required: true,
			},
			{
				name: "role",
				help: "Role to grant. Default MEMBER.",
				body: "role",
				values: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
			},
		],
		scope: "write",
		auth: true,
		confirm: "Sends a workspace invitation to this email. An open invitation is sent again with this role. Re-run with --yes.",
		help: "Invite someone to the workspace by email. Role defaults to MEMBER. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "workspace.invitations.delete",
		words: ["workspace", "invitations", "delete"],
		method: "DELETE",
		path: "/workspace/invitations/{invitationId}",
		args: [stringArg("invitationId")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Cancels a pending or expired invitation so its link stops working. Re-run with --yes.",
		help: "Cancel a pending or expired invitation. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "workspace.members",
		words: ["workspace", "members"],
		method: "GET",
		path: "/workspace/members",
		args: [],
		flags: [],
		scope: "read",
		auth: true,
		summary: "list",
		summaryKey: "members",
		help: "List workspace members and their roles. Requires an account-scoped key.",
	}),
	cmd({
		id: "workspace.members.update",
		words: ["workspace", "members", "update"],
		method: "PATCH",
		path: "/workspace/members/{email}",
		args: [stringArg("email")],
		flags: [
			{
				name: "role",
				help: "New role.",
				body: "role",
				required: true,
				values: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
			},
		],
		scope: "write",
		auth: true,
		confirm: "Changes this member's role. Re-run with --yes.",
		help: "Change a member's role. Requires --yes, the write scope, and an account-scoped key.",
	}),
	cmd({
		id: "workspace.members.delete",
		words: ["workspace", "members", "delete"],
		method: "DELETE",
		path: "/workspace/members/{email}",
		args: [stringArg("email")],
		flags: [],
		scope: "write",
		auth: true,
		confirm: "Removes this member from the workspace. It does not remove an allowed email domain. Re-run with --yes.",
		help: "Remove a member. Requires --yes, the write scope, and an account-scoped key.",
	}),
] as const;

export type CommandId = (typeof REGISTRY)[number]["id"];

function cmd<const T extends CommandSpec>(spec: T): T {
	return spec;
}

function integerArg(name: string): ArgSpec {
	return { name, kind: "integer", param: name };
}

function stringArg(name: string): ArgSpec {
	return { name, kind: "string", param: name };
}

function integerQuery(name: string, query: string, help: string): FlagSpec {
	return { name, help, query, integer: true };
}

function enumQuery(name: string, query: string, values: readonly string[], help: string): FlagSpec {
	return { name, help, query, values };
}

const DATE_FLAGS: readonly FlagSpec[] = [
	{ name: "from", help: "Range start, ISO-8601 with a timezone offset.", query: "from" },
	{ name: "to", help: "Range end, ISO-8601 with a timezone offset.", query: "to" },
	{ name: "since", help: "Relative range: 24h, 7d, or 30d. Sets --to to now.", values: ["24h", "7d", "30d"] },
];

const PAGE_FLAGS: readonly FlagSpec[] = [
	{ name: "cursor", help: "Page cursor from a previous response.", query: "cursor" },
	{ name: "limit", help: ACTIVITY_LIMIT, query: "limit", integer: true },
	{ name: "all", help: "Follow nextCursor until the server reports no more pages.", boolean: true },
	{ name: "max-pages", help: `Stop after this many pages. Default ${200}.`, integer: true },
];

export function flagsFor(command: CommandSpec): readonly FlagSpec[] {
	const flags = [...command.flags];
	if (command.dateRange === "required") flags.push(...DATE_FLAGS);
	if (command.paginated) {
		for (const flag of PAGE_FLAGS) {
			if (flag.name === "limit") {
				flags.push({ ...flag, help: command.paginated === "webhook" ? WEBHOOK_LIMIT : ACTIVITY_LIMIT });
			} else {
				flags.push(flag);
			}
		}
	}
	if (command.confirm) {
		flags.push({ name: "yes", help: "Confirm this write.", boolean: true, required: true });
	}
	return flags;
}

export function limitMax(command: CommandSpec): number | undefined {
	if (command.paginated === "activity") return 500;
	if (command.paginated === "webhook") return 100;
	return undefined;
}

assertRegistry();

function assertRegistry(): void {
	const ids = new Set<string>();
	const words = new Set<string>();
	const routes = new Set<string>();
	for (const command of REGISTRY) {
		if (ids.has(command.id)) throw new Error(`duplicate command id ${command.id}`);
		ids.add(command.id);
		const label = command.words.join(" ");
		if (words.has(label)) throw new Error(`duplicate command ${label}`);
		words.add(label);
		if (command.id !== "openapi") {
			const route = `${command.method} ${command.path}`;
			if (routes.has(route)) throw new Error(`duplicate route ${route}`);
			routes.add(route);
		}
		const helpText: string = command.help;
		if (helpText.length === 0) throw new Error(`missing help for ${command.id}`);
	}
}

export type ResolvedCommand =
	| { type: "command"; command: CommandSpec; args: readonly string[] }
	| { type: "group"; commands: readonly CommandSpec[] }
	| { type: "unknown" };

export function resolveCommand(positionals: readonly string[]): ResolvedCommand {
	const ranked = [...REGISTRY].sort((left, right) => right.words.length - left.words.length);
	for (const command of ranked) {
		if (positionals.length < command.words.length) continue;
		const matches = command.words.every((word, index) => positionals[index] === word);
		if (matches) {
			return { type: "command", command, args: positionals.slice(command.words.length) };
		}
	}
	const group = REGISTRY.filter(
		(command) =>
			command.words.length > positionals.length &&
			positionals.every((word, index) => command.words[index] === word),
	);
	if (group.length > 0) return { type: "group", commands: group };
	return { type: "unknown" };
}
