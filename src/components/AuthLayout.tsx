import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function AuthLayout({
    title,
    description,
    label = "Кабинет владельца",
    children,
    footer,
    showRoleLink = true,
    mode = "form",
}: {
    title: string;
    description: string;
    label?: string;
    children: ReactNode;
    footer?: ReactNode;
    showRoleLink?: boolean;
    mode?: "form" | "roles";
}) {
    return (
        <main className="auth-shell">
            <header className="auth-topbar">
                <div className="auth-topbar-inner">
                    <Link className="brand-link" to="/login">
                        <span className="brand-mark" aria-hidden="true" />
                        SaleBase
                    </Link>
                    <span className="auth-topbar-caption">Рабочее пространство</span>
                    {showRoleLink && (
                        <Link className="auth-back" to="/login">
                            <span aria-hidden="true">←</span> К выбору роли
                        </Link>
                    )}
                </div>
            </header>
            <section className="auth-stage" aria-labelledby="auth-title">
                <div className={mode === "roles" ? "auth-card auth-card-roles" : "auth-card"}>
                    <header className="auth-card-header">
                        <p className="auth-label">{label}</p>
                        <h1 id="auth-title">{title}</h1>
                        <p className="auth-description">{description}</p>
                    </header>
                    {children}
                    {footer && <div className="auth-footer">{footer}</div>}
                </div>
            </section>
        </main>
    );
}
