import "../styles/throbber.css";

type ThrobberProps = {
    label?: string;
    className?: string;
};

export default function Throbber({ label = "Загрузка...", className = "" }: ThrobberProps) {
    return (
        <div className={`throbber ${className}`} role="status">
            <div className="throbber-scene" aria-hidden="true">
                <span className="throbber-orbit throbber-orbit-outer">
                    <svg viewBox="0 0 120 120" fill="none">
                        <circle className="throbber-track" cx="60" cy="60" r="53" />
                        <path className="throbber-trail" d="M60 7a53 53 0 0 1 53 53" />
                        <circle className="throbber-satellite" cx="113" cy="60" r="4" />
                        <circle className="throbber-satellite-tail" cx="7" cy="60" r="2" />
                    </svg>
                </span>
                <span className="throbber-orbit throbber-orbit-inner">
                    <svg viewBox="0 0 88 88" fill="none">
                        <circle className="throbber-track" cx="44" cy="44" r="39" />
                        <path className="throbber-trail" d="M5 44a39 39 0 0 1 39-39" />
                        <circle className="throbber-satellite" cx="44" cy="5" r="2.5" />
                    </svg>
                </span>
                <span className="throbber-core">
                    <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="m4 4-2 5v1a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0V9l-2-5Z" />
                        <path d="M4 13v7h16v-7M9 20v-5h6v5M9 4 7 9m8-5 2 5M2 9h20" />
                    </svg>
                </span>
            </div>
            <span className="sr-only">{label}</span>
        </div>
    );
}
