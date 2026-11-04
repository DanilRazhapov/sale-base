import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";

export default function LoginPage() {
    return (
        <AuthLayout
            label="Вход в SaleBase"
            title="Выберите рабочее место"
            description="Войдите в кабинет владельца или откройте кассу."
            showRoleLink={false}
            mode="roles"
        >
            <div className="auth-options">
                <Link className="auth-option" to="/login/owner">
                    <span className="auth-option-top" aria-hidden="true">
                        <span className="auth-option-icon">
                            <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinejoin="round"
                            >
                                <path d="M4 10h16l-2-5H6zM5 10v9h14v-9M10 19v-5h4v5" />
                            </svg>
                        </span>
                        <span className="auth-option-arrow">→</span>
                    </span>
                    <span className="auth-option-copy">
                        <strong>Владелец</strong>
                        <span>Управление магазинами, товарами и командой.</span>
                    </span>
                    <small className="auth-option-method">Почта и пароль</small>
                </Link>
                <Link className="auth-option" to="/login/cashier">
                    <span className="auth-option-top" aria-hidden="true">
                        <span className="auth-option-icon">
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
                        <span className="auth-option-arrow">→</span>
                    </span>
                    <span className="auth-option-copy">
                        <strong>Кассир</strong>
                        <span>Продажи, корзина и работа с кассовой сменой.</span>
                    </span>
                    <small className="auth-option-method">Имя и PIN</small>
                </Link>
            </div>
        </AuthLayout>
    );
}
