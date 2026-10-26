import { Github } from "lucide-react";
import { XGlyph } from "./brand-icons";

function Footer() {
  return (
    <div className="w-full py-6">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        <a
          href="https://togetherai.link/?utm_source=pdf-to-interactive-lesson&utm_medium=referral&utm_campaign=example-app"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Powered by together.ai"
          className="interactive inline-flex items-center gap-2 h-7 px-3 rounded-full bg-white border border-border"
        >
          <span className="text-xs font-medium text-neutral-600">Powered by</span>
          <img src="/together-logo-light.png" alt="Together AI" className="h-3.5 w-auto" />
        </a>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/Nutlope/pdf-to-interactive-lesson"
            target="_blank"
            rel="noopener noreferrer"
            className="interactive w-8 h-8 rounded-full bg-surface-muted border border-border flex items-center justify-center text-neutral-600 hover:text-neutral-900"
            aria-label="GitHub"
          >
            <Github className="w-4 h-4" />
          </a>
          <a
            href="https://x.com/nutlope"
            target="_blank"
            rel="noopener noreferrer"
            className="interactive w-8 h-8 rounded-full bg-surface-muted border border-border flex items-center justify-center text-neutral-600 hover:text-neutral-900"
            aria-label="X (Twitter)"
          >
            <XGlyph className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

export { Footer };
