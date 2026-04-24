import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
	return (
		<SidebarProvider className="h-svh overflow-hidden">
			<AppSidebar />
			<SidebarInset className="flex min-h-0 flex-col overflow-hidden">
				<AppHeader />
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
