import { ui } from "../../lib/ui";
import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../../components/AuthLayout";

const RegisterPage = () => {
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [busy, setBusy] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const submitting = useRef(false);
    const navigate = useNavigate();

    async function handleRegister(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (submitting.current) return;
        if (!fullName.trim()) {
            setErrorMessage("Введите ваше имя.");
            return;
        }
        submitting.current = true;
        setBusy(true);
        setErrorMessage("");
        try {
            const { error } = await supabase.auth.signUp({
                email: email.trim(),
                password,
                options: {
                    data: {
                        full_name: fullName.trim(),
                    },
                },
            });

            if (error) {
                setErrorMessage(error.message);
                return;
            }

            navigate("/login/owner", { state: { registered: true } });
        } catch {
            setErrorMessage("Не удалось создать аккаунт. Проверьте подключение и попробуйте снова.");
        } finally {
            submitting.current = false;
            setBusy(false);
        }
    }

    return (
        <AuthLayout
            title="Создайте аккаунт"
            description="Начните с регистрации — затем добавьте магазин и кассиров."
            footer={
                <>
                    Уже зарегистрированы? <Link to="/login/owner">Войти в кабинет</Link>
                </>
            }
        >
            <form onSubmit={handleRegister} aria-busy={busy}>
                <fieldset className={ui.fieldset} disabled={busy}>
                    <label className={ui.label} htmlFor="register-name">
                        Ваше имя
                        <input
                            className={ui.input}
                            id="register-name"
                            name="name"
                            autoComplete="name"
                            placeholder="Как к вам обращаться"
                            maxLength={120}
                            required
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                        />
                    </label>
                    <label className={ui.label} htmlFor="register-email">
                        Электронная почта
                        <input
                            className={ui.input}
                            id="register-email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </label>
                    <label className={ui.label} htmlFor="register-password">
                        Пароль
                        <input
                            className={ui.input}
                            id="register-password"
                            name="password"
                            type="password"
                            autoComplete="new-password"
                            placeholder="Придумайте пароль"
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
                        {busy ? "Создаём аккаунт…" : "Создать аккаунт"}
                        <span aria-hidden="true">→</span>
                    </button>
                </fieldset>
            </form>
        </AuthLayout>
    );
};

export default RegisterPage;
