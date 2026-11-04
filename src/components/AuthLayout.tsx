import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function AuthLayout({
    title,
    description,
    label = "Кабинет владельца",
    children,
    footer,
    showRoleLink = true,
}: {
    title: string;
    description: string;
    label?: string;
    children: ReactNode;
    footer?: ReactNode;
    showRoleLink?: boolean;
}) {
    return (
        <main className="auth-shell">
            <aside className="auth-station" aria-label="О SaleBase">
                <Link className="brand-link auth-brand" to="/login">
                    <span className="brand-mark" aria-hidden="true" />
                    SaleBase
                </Link>
                <div className="auth-station-intro">
                    <p className="auth-station-title">
                        Торговая <span>станция</span>
                    </p>
                    <p className="auth-station-description">
                        Продажи, склад и команда магазина в одном рабочем пространстве.
                    </p>
                    <ul className="auth-station-modules">
                        <li>
                            <span aria-hidden="true">01</span>Касса
                        </li>
                        <li>
                            <span aria-hidden="true">02</span>Склад
                        </li>
                        <li>
                            <span aria-hidden="true">03</span>Команда
                        </li>
                    </ul>
                </div>
                <div className="auth-station-footer" aria-hidden="true">
                    <span>SALEBASE / POS</span>
                    <span className="auth-barcode" />
                </div>
            </aside>
            <section className="auth-stage" aria-labelledby="auth-title">
                <div className="auth-frame">
                    {showRoleLink && (
                        <Link className="auth-back" to="/login">
                            <span aria-hidden="true">←</span> К выбору роли
                        </Link>
                    )}
                    <div className="auth-card">
                        <header className="auth-card-header">
                            <p className="auth-label">{label}</p>
                            <h1 id="auth-title">{title}</h1>
                            <p className="auth-description">{description}</p>
                        </header>
                        {children}
                        {footer && <div className="auth-footer">{footer}</div>}
                    </div>
                </div>
            </section>
        </main>
    );
}
