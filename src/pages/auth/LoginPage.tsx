import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";

export default function LoginPage() {
    return (
        <AuthLayout
            label="Вход в SaleBase"
            title="Выберите рабочее место"
            description="Способ входа зависит от вашей роли в магазине."
            showRoleLink={false}
        >
            <div className="auth-options">
                <Link className="auth-option" to="/login/owner">
                    <span className="auth-option-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
                        </svg>
                    </span>
                    <span className="auth-option-copy">
                        <strong>Владелец</strong>
                        <span>Магазины, товары и сотрудники</span>
                        <small>Вход по почте и паролю</small>
                    </span>
                    <span className="auth-option-arrow" aria-hidden="true">
                        →
                    </span>
                </Link>
                <Link className="auth-option" to="/login/cashier">
                    <span className="auth-option-icon" aria-hidden="true">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                        >
                            <rect x="4" y="5" width="16" height="14" rx="2" />
                            <path d="M7 9h10M8 15h1m3 0h1m3 0h1" />
                        </svg>
                    </span>
                    <span className="auth-option-copy">
                        <strong>Кассир</strong>
                        <span>Продажи, корзина и кассовая смена</span>
                        <small>Вход по имени и PIN</small>
                    </span>
                    <span className="auth-option-arrow" aria-hidden="true">
                        →
                    </span>
                </Link>
            </div>
        </AuthLayout>
    );
}
