import { ui } from "../../lib/ui";
import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { Link, useLocation } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";

const OwnerLoginPage = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const submitting = useRef(false);
    const location = useLocation();

    async function handleLogIn(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        setBusy(true);
        setErrorMessage("");
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email: email.trim(),
                password,
            });
            if (error) setErrorMessage(error.message);
        } catch {
            setErrorMessage("Не удалось войти. Проверьте подключение и попробуйте снова.");
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    }

    return (
        <AuthLayout
            title="Вход владельца"
            description="Войдите, чтобы управлять магазинами и следить за их работой."
            footer={
                <>
                    Ещё нет аккаунта? <Link to="/register">Зарегистрироваться</Link>
                </>
            }
        >
            {location.state?.registered && (
                <p className="alert-success" role="status">
                    Аккаунт создан. Проверьте почту, если требуется подтверждение регистрации.
                </p>
            )}
            <form onSubmit={handleLogIn} aria-busy={busy}>
                <fieldset className={ui.fieldset} disabled={busy}>
                    <label className={ui.label} htmlFor="login-email">
                        Электронная почта
                        <input
                            className={ui.input}
                            id="login-email"
                            name="email"
                            autoComplete="email"
                            type="email"
                            placeholder="you@example.com"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </label>
                    <label className={ui.label} htmlFor="login-password">
                        Пароль
                        <input
                            className={ui.input}
                            id="login-password"
                            name="password"
                            autoComplete="current-password"
                            type="password"
                            placeholder="Введите пароль"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </label>
                    {errorMessage && (
                        <p className="alert-error" role="alert">
                            {errorMessage}
                        </p>
                    )}
                    <button className={ui.buttonBase + " button-submit"} type="submit">
                        {busy ? "Входим…" : "Войти в кабинет"}
                        <span aria-hidden="true">→</span>
                    </button>
                </fieldset>
            </form>
        </AuthLayout>
    );
};

export default OwnerLoginPage;
