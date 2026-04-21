import type { ReactNode } from "react";
import {
  LayoutGrid,
  ListChecks,
  BarChart3,
  MessageSquareText,
  Users,
  Plug,
  Settings,
  HelpCircle,
  Activity,
} from "lucide-react";

export type SidebarNavItem = {
  title: string;
  path?: string;
  icon?: ReactNode;
  isActive?: boolean;
  subItems?: SidebarNavItem[];
};

export type SidebarNavGroup = {
  label?: string;
  items: SidebarNavItem[];
};

export const navGroups: SidebarNavGroup[] = [
  {
    items: [
      {
        title: "Overview",
        path: "#/overview",
        icon: <LayoutGrid />,
        isActive: true,
      },
    ],
  },
  {
    label: "Today",
    items: [
      { title: "Queue", path: "#/queue", icon: <ListChecks /> },
      { title: "Team insights", path: "#/team-insights", icon: <BarChart3 /> },
    ],
  },
  {
    label: "Inbox",
    items: [
      {
        title: "Conversations",
        icon: <MessageSquareText />,
        subItems: [
          { title: "Unassigned", path: "#/inbox/unassigned" },
          { title: "Assigned to me", path: "#/inbox/assigned" },
          { title: "Recently closed", path: "#/inbox/closed" },
        ],
      },
      { title: "Customers", path: "#/customers", icon: <Users /> },
      { title: "Channels", path: "#/channels", icon: <Plug /> },
    ],
  },
  {
    label: "Organization",
    items: [
      {
        title: "Workspace",
        icon: <Settings />,
        subItems: [
          { title: "Branding", path: "#/workspace/branding" },
          { title: "Team & roles", path: "#/workspace/team" },
          { title: "API keys", path: "#/workspace/api-keys" },
          { title: "Webhooks", path: "#/workspace/webhooks" },
          { title: "Billing", path: "#/workspace/billing" },
        ],
      },
    ],
  },
];

export const footerNavLinks: SidebarNavItem[] = [
  { title: "Help Center", path: "#/help", icon: <HelpCircle /> },
  { title: "System status", path: "#/status", icon: <Activity /> },
];

export const navLinks: SidebarNavItem[] = [
  ...navGroups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.subItems?.length ? [item, ...item.subItems] : [item],
    ),
  ),
  ...footerNavLinks,
];
