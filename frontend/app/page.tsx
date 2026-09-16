import Link from "next/link";
import { DatabaseZap, Shield, Activity, TerminalSquare, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export default function HomePage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-8">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-10 order-2 lg:order-1">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 rounded-full bg-white/5 border border-white/10 backdrop-blur-md px-5 py-3">
              <div className="h-9 w-9 rounded-full bg-gradient-accent flex items-center justify-center">
                <DatabaseZap className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-gradient">PgGuardian</p>
                <p className="text-[11px] text-muted-foreground">v1.0.0</p>
              </div>
            </div>

            <h1 className="text-5xl lg:text-6xl font-bold leading-[1.05]">
              PostgreSQL{" "}
              <span className="text-gradient">Yönetim</span>
              <br />
              ve <span className="text-gradient">Teşhis</span> Merkezi
            </h1>

            <p className="text-lg text-muted-foreground max-w-xl leading-relaxed">
              Bağlantı yönetimi, performans teşhisi, SQL düzenleyici,
              sorgu yönetimi, yedekleme ve bakım işlemleri için tek panel.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: Activity, title: "Gerçek Zamanlı Teşhis", desc: "Canlı sorgular, kilitler ve sağlık" },
              { icon: TerminalSquare, title: "SQL Editör", desc: "Syntax ve güvenlik sınıflandırması" },
              { icon: Shield, title: "Güvenli Profil", desc: "Şifreleri yerel (YARA) + AES-256 ile sakla" },
              { icon: DatabaseZap, title: "Bakım & Yedekleme", desc: "VACUUM, REINDEX, snapshot ve rapor" },
            ].map((f) => (
              <Card key={f.title} className="bg-white/5 backdrop-blur-md border-white/10 shadow-xl">
                <CardContent className="p-5 space-y-2.5">
                  <div className="h-10 w-10 rounded-full bg-gradient-accent/20 flex items-center justify-center">
                    <f.icon className="h-5 w-5 text-gradient" />
                  </div>
                  <h3 className="font-semibold text-white">{f.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <Card className="order-1 lg:order-2 border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
          <CardContent className="p-10 space-y-8">
            <div className="space-y-3">
              <h2 className="text-3xl font-bold text-white">Panele Giriş</h2>
              <p className="text-muted-foreground">
                Korumalı rotalara erişmek için lütfen giriş yapın.
              </p>
            </div>

            <form action="/api/v1/auth/login" method="POST" className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="username">Kullanıcı Adı</Label>
                <Input
                  id="username"
                  name="username"
                  placeholder="admin"
                  autoComplete="username"
                  defaultValue="admin"
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="password">Şifre</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox id="remember" name="remember" />
                  <Label htmlFor="remember" className="text-sm cursor-pointer">
                    Beni hatırla
                  </Label>
                </div>
                <a
                  href="#forgot"
                  className="text-sm text-gradient hover:underline"
                >
                  Şifremi unuttum
                </a>
              </div>

              <Button type="submit" className="w-full h-14 text-base">
                Giriş Yap
                <ArrowRight className="h-5 w-5 ml-1" />
              </Button>

              <div className="text-center text-xs text-muted-foreground">
                İlk kullanım için <Link href="/dashboard" className="text-gradient hover:underline">geliştirici modunu</Link> aktif edin
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
