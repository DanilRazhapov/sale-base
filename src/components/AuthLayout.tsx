import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "../css/AppPages.css";
import "../css/AuthPages.css";

export function AuthLayout({ title, description, children, footer }: {
    title: string; description: string; children: ReactNode; footer: ReactNode;
}) {
    return <main className="app-page auth-page">
        <section className="auth-story" aria-label="SaleBase">
            <Link className="app-brand" to="/login"><span className="app-brand-mark">S</span>SaleBase</Link>
            <div className="auth-story-content">
                <span className="app-eyebrow">УПРАВЛЕНИЕ МАГАЗИНОМ</span>
                <h1>Всё важное.<br />В одном месте.</h1>
                <p>Товары, остатки и работа кассиров — под вашим контролем, где бы вы ни находились.</p>
                <div className="auth-features">
                    <div><span aria-hidden="true">▦</span><p><strong>Магазины и товары</strong><small>Единый каталог и категории</small></p></div>
                    <div><span aria-hidden="true">↗</span><p><strong>Актуальные остатки</strong><small>Продажи, приходы и списания</small></p></div>
                    <div><span aria-hidden="true">◷</span><p><strong>Кассиры и смены</strong><small>История действий и учёт кассы</small></p></div>
                </div>
            </div>
            <p className="auth-story-footer">Больше порядка. Меньше ручной работы.</p>
        </section>
        <section className="auth-form-side">
            <div className="auth-card">
                <span className="app-eyebrow">КАБИНЕТ ВЛАДЕЛЬЦА</span>
                <h2>{title}</h2><p className="app-muted auth-description">{description}</p>
                {children}
                <div className="auth-footer">{footer}</div>
            </div>
            <Link className="auth-cashier-link" to="/cashier">Работаете на кассе? <span>Войти кассиром →</span></Link>
        </section>
    </main>;
}
