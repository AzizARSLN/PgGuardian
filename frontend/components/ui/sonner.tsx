"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "dark" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-white/10 group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-2xl group-[.toaster]:backdrop-blur-xl group-[.toaster]:rounded-3xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-gradient-to-r group-[.toast]:from-indigo-500 group-[.toast]:to-emerald-500 group-[.toast]:text-white group-[.toast]:rounded-full",
          cancelButton:
            "group-[.toast]:bg-white/10 group-[.toast]:text-muted-foreground group-[.toast]:rounded-full",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
