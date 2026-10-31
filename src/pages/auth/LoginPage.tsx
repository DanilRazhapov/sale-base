import { Link } from "react-router-dom";
import { ui } from "../../lib/ui";

export default function LoginPage() {
    return (
        <main className="login-page">
            <section className="login-card">
                <Link className="brand-link" to="/login">
                    <span className="brand-mark">S</span>SaleBase
                </Link>
                <h1 className={ui.title}>Вход в SaleBase</h1>
                <p>Выберите своё рабочее место.</p>
                <div className="login-options">
                    <Link className="login-option" to="/login/owner">
                        <strong>Владелец</strong>
                        <span>Магазины, товары, сотрудники и отчёты. Вход по электронной почте и паролю.</span>
                    </Link>
                    <Link className="login-option" to="/login/cashier">
                        <strong>Кассир</strong>
                        <span>Продажи, корзина и своя смена. Вход по имени и PIN.</span>
                    </Link>
                </div>
            </section>
        </main>
    );
}
