import { ui } from "../lib/ui";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function AuthLayout({
    title,
    description,
    children,
    footer,
}: {
    title: string;
    description: string;
    children: ReactNode;
    footer: ReactNode;
}) {
    return (
        <main className="owner-auth">
            <section className="owner-auth-sidebar" aria-label="SaleBase">
                <Link className="brand-link" to="/login">
                    <span className="brand-mark">S</span>SaleBase
                </Link>
                <div className="owner-auth-intro">
                    <span className={ui.eyebrow}>УПРАВЛЕНИЕ МАГАЗИНОМ</span>
                    <h1 className={ui.title}>
                        Всё важное.
                        <br />В одном месте.
                    </h1>
                    <p>Товары, остатки и работа кассиров — под вашим контролем, где бы вы ни находились.</p>
                    <div className="owner-auth-features">
                        <div>
                            <span aria-hidden="true">▦</span>
                            <p>
                                <strong>Магазины и товары</strong>
                                <small>Единый каталог и категории</small>
                            </p>
                        </div>
                        <div>
                            <span aria-hidden="true">↗</span>
                            <p>
                                <strong>Актуальные остатки</strong>
                                <small>Продажи, приходы и списания</small>
                            </p>
                        </div>
                        <div>
                            <span aria-hidden="true">◷</span>
                            <p>
                                <strong>Кассиры и смены</strong>
                                <small>История действий и учёт кассы</small>
                            </p>
                        </div>
                    </div>
                </div>
                <p className="owner-auth-caption">Больше порядка. Меньше ручной работы.</p>
            </section>
            <section className="owner-auth-form">
                <div className="owner-auth-card">
                    <span className={ui.eyebrow}>КАБИНЕТ ВЛАДЕЛЬЦА</span>
                    <h2 className={ui.heading}>{title}</h2>
                    <p className="owner-auth-description">{description}</p>
                    {children}
                    <div className="owner-auth-footer">{footer}</div>
                </div>
                <Link className="owner-auth-switch" to="/login">
                    <span>Выбрать другой способ входа →</span>
                </Link>
            </section>
        </main>
    );
}
