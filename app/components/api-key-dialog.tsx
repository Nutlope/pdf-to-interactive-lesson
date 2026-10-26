"use client";

import { useState, useEffect, useRef } from "react";
import { ExternalLink, Eye, EyeOff, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer";
import { useMediaQuery } from "../hooks/use-media-query";
import { getApiKey, saveApiKey, removeApiKey } from "@/lib/api-key-storage";

interface ApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message?: string;
}

// Move components outside to avoid creating them during render
const GridIcon = () => (
  <div className="grid grid-cols-3 gap-0.5 w-4 h-4">
    <div className="w-1 h-1 bg-neutral-600 rounded-sm"></div>
    <div className="w-1 h-1 bg-neutral-600 rounded-sm"></div>
    <div className="w-1 h-1 bg-neutral-600 rounded-sm"></div>
    <div className="w-1 h-1 bg-neutral-600 rounded-sm"></div>
    <div className="w-1 h-1 bg-neutral-600 rounded-sm"></div>
    <div className="w-1 h-1 bg-neutral-600 rounded-sm"></div>
    <div className="w-1 h-1 bg-neutral-600 rounded-sm"></div>
    <div className="w-1 h-1 bg-neutral-600 rounded-sm"></div>
    <div className="w-1 h-1 bg-neutral-600 rounded-sm"></div>
  </div>
);

interface ApiKeyFormProps {
  className?: string;
  apiKey: string;
  savedApiKey: string | null;
  showApiKey: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  submitButtonRef: React.RefObject<HTMLButtonElement | null>;
  onApiKeyChange: (value: string) => void;
  onShowApiKeyToggle: () => void;
  onSave: () => void;
  onRemove: () => void;
}

const ApiKeyForm = ({
  className,
  apiKey,
  savedApiKey,
  showApiKey,
  inputRef,
  submitButtonRef,
  onApiKeyChange,
  onShowApiKeyToggle,
  onSave,
  onRemove,
}: ApiKeyFormProps) => (
  <div className={className}>
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (apiKey.trim()) {
          onSave();
        }
      }}
      className="space-y-4"
    >
      <div className="text-base text-neutral-900">
        {savedApiKey ? "Update" : "Add"} your{" "}
        <span className="font-semibold underline">Together AI</span> API key
      </div>
      <div className="relative">
        <input
          ref={inputRef}
          type={showApiKey ? "text" : "password"}
          placeholder="API Key"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          onPaste={() => {
            // Focus the submit button after paste
            setTimeout(() => {
              submitButtonRef.current?.focus();
            }, 0);
          }}
          className="w-full px-4 py-2 pr-20 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent text-neutral-900 placeholder:text-neutral-400"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {apiKey && (
            <button
              type="button"
              onClick={() => {
                onApiKeyChange("");
                inputRef.current?.focus();
              }}
              className="p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors touch-manipulation"
              aria-label="Clear API key"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={onShowApiKeyToggle}
            className="p-1.5 text-neutral-400 hover:text-neutral-600 transition-colors touch-manipulation"
            aria-label={showApiKey ? "Hide API key" : "Show API key"}
          >
            {showApiKey ? (
              <EyeOff className="w-5 h-5" />
            ) : (
              <Eye className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
      <ul className="space-y-2 text-sm text-neutral-600">
        <li className="flex items-start">
          <span className="mr-2">•</span>
          <span>
            Visit{" "}
            <a
              href="https://togetherai.link/?utm_source=pdf-to-interactive-lesson&utm_medium=referral&utm_campaign=example-app"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900"
            >
              together.ai
            </a>{" "}
            and sign up for free
          </span>
        </li>
        <li className="flex items-start">
          <span className="mr-2">•</span>
          <span>Copy your API key and paste it above</span>
        </li>
      </ul>
      <div className="flex flex-col gap-3">
        <Button
          ref={submitButtonRef}
          type="submit"
          disabled={!apiKey.trim()}
          shape="lg"
          className="w-full"
        >
          {savedApiKey ? "Update API Key" : "Save API Key"}
        </Button>
        <div className="flex items-center justify-between text-sm pt-2 gap-6">
          <a
            href="https://togetherai.link/?utm_source=pdf-to-interactive-lesson&utm_medium=referral&utm_campaign=example-app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-600 hover:text-neutral-900 underline flex items-center gap-1"
          >
            Get your API key
            <ExternalLink className="w-3 h-3" />
          </a>
          {savedApiKey && (
            <button
              type="button"
              onClick={onRemove}
              className="text-red-600 hover:text-red-700 underline text-sm"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </form>
  </div>
);

export function ApiKeyDialog({ open, onOpenChange, message }: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState("");
  const [savedApiKey, setSavedApiKey] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const inputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const hasLoadedRef = useRef(false);

  // Load saved API key when dialog opens - only once per open
  useEffect(() => {
    if (!open) {
      hasLoadedRef.current = false;
      return;
    }
    
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    
    const storedKey = getApiKey();
    // Defer state updates to avoid cascading renders
    const timeoutId = setTimeout(() => {
      setSavedApiKey(storedKey);
      setApiKey(storedKey || "");
      // Auto-focus the input when dialog opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }, 0);
    
    return () => clearTimeout(timeoutId);
  }, [open]);

  const handleSaveApiKey = () => {
    if (apiKey.trim()) {
      saveApiKey(apiKey.trim());
      setSavedApiKey(apiKey.trim());
      onOpenChange(false);
    }
  };

  const handleRemoveApiKey = () => {
    removeApiKey();
    setSavedApiKey(null);
    setApiKey("");
  };

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md bg-white rounded-lg">
          <DialogHeader className="pb-4">
            <div className="flex items-center gap-2">
              <GridIcon />
              <DialogTitle className="text-left text-lg font-semibold text-neutral-900">
                Together AI API key
              </DialogTitle>
            </div>
          </DialogHeader>
          {message && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
              {message}
            </p>
          )}
          <ApiKeyForm
            apiKey={apiKey}
            savedApiKey={savedApiKey}
            showApiKey={showApiKey}
            inputRef={inputRef}
            submitButtonRef={submitButtonRef}
            onApiKeyChange={setApiKey}
            onShowApiKeyToggle={() => setShowApiKey(!showApiKey)}
            onSave={handleSaveApiKey}
            onRemove={handleRemoveApiKey}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-md mx-auto">
        <DrawerHeader className="pb-4">
          <div className="flex items-center gap-2">
            <GridIcon />
            <DrawerTitle className="text-left text-neutral-900">Together AI API key</DrawerTitle>
          </div>
        </DrawerHeader>
        {message && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mx-4 mb-2">
            {message}
          </p>
        )}
        <ApiKeyForm
          apiKey={apiKey}
          savedApiKey={savedApiKey}
          showApiKey={showApiKey}
          inputRef={inputRef}
          submitButtonRef={submitButtonRef}
          onApiKeyChange={setApiKey}
          onShowApiKeyToggle={() => setShowApiKey(!showApiKey)}
          onSave={handleSaveApiKey}
          onRemove={handleRemoveApiKey}
        />
      </DrawerContent>
    </Drawer>
  );
}

