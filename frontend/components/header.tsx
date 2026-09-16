"use client";

import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Moon,
  Sun,
  Lock,
  Menu,
  Shield,
  DatabaseZap,
  LogOut,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUIStore } from "@/store/use-ui-store";
import { useAuthStore } from "@/store/useAuthStore";

export default function Header() {
  const { setTheme, resolvedTheme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const { setSidebarOpen } = useUIStore();
  const { user, logout } = useAuthStore();
  const router = useRouter();

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      window.location.reload();
    }, 400);
  };

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-white/5 backdrop-blur-xl flex items-center gap-3 md:gap-4 px-3 md:px-6 lg:px-8 h-14 lg:h-16">
      <button
        onClick={() => setSidebarOpen(true)}
        className="lg:hidden p-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex items-center gap-2 lg:gap-3">
        <div className="h-9 w-9 lg:h-10 lg:w-10 rounded-full bg-gradient-accent flex items-center justify-center shadow shrink-0">
          <DatabaseZap className="h-4.5 w-4.5 lg:h-5 lg:w-5 text-white" />
        </div>
        <div className="hidden lg:flex flex-col gap-0.5">
          <h1 className="text-xl font-bold text-gradient">PgGuardian</h1>
          <p className="text-xs text-muted-foreground">
            PostgreSQL Veritabanı Yönetim ve Teşhis Paneli
          </p>
        </div>
        <span className="lg:hidden text-lg font-bold text-gradient">PgG</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 md:gap-2">
        <Button
          variant="outline"
          size="icon"
          className="rounded-full bg-white/5 border-white/10 hover:bg-white/10 backdrop-blur-md h-9 w-9"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 md:h-5 md:w-5 ${refreshing ? "animate-spin" : ""}`} />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="rounded-full bg-white/5 border-white/10 hover:bg-white/10 backdrop-blur-md h-9 w-9"
          onClick={toggleTheme}
        >
          <Sun className="h-4 w-4 md:h-5 md:w-5 dark:hidden" />
          <Moon className="h-4 w-4 md:h-5 md:w-5 hidden dark:block" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          className="rounded-full bg-white/5 border-white/10 hover:bg-white/10 backdrop-blur-md h-9 w-9 hide-mobile"
          asChild
        >
          <span>
            <Lock className="h-4 w-4 md:h-5 md:w-5" />
          </span>
        </Button>
      </div>

      <div className="ml-1 md:ml-2 h-8 w-px bg-white/10" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-2 lg:gap-3 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 backdrop-blur-md pl-1.5 lg:pl-1.5 pr-3 lg:pr-5 py-1.5 transition-colors">
            <div className="relative">
              <Avatar className="h-7 w-7 lg:h-9 lg:w-9">
                <AvatarFallback className="text-xs lg:text-sm">
                  {user?.email
                    ? user.email.charAt(0).toUpperCase() + user.email.split("@")[0].charAt(1)?.toUpperCase() || ""
                    : "AA"}
                </AvatarFallback>
              </Avatar>
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 lg:h-3.5 lg:w-3.5 rounded-full bg-emerald-500 border-2 border-zinc-950" />
            </div>
            <div className="hidden lg:flex flex-col items-start leading-tight">
              <span className="text-sm font-semibold text-white truncate max-w-[140px]">
                {user?.email || "Admin"}
              </span>
              <Badge
                variant="default"
                className="h-5 px-2 text-[10px] flex items-center gap-1 mt-0.5"
              >
                <Shield className="h-3 w-3" />
                {user?.role || "Active"}
              </Badge>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Hesap</DropdownMenuLabel>
          {user && (
            <>
              <div className="px-2 py-2">
                <p className="text-sm font-medium truncate">{user.email}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Shield className="h-3 w-3" />
                  {user.role}
                </p>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem>
            <span className="flex items-center gap-2">Profil</span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <span className="flex items-center gap-2">Tercihler</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleLogout}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Oturumu Kapat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
