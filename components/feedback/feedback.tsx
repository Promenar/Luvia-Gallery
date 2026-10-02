import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/kit/alert-dialog';
import { Input } from '@/components/kit/input';
import { Label } from '@/components/kit/label';
import { useLanguage } from '../../contexts/LanguageContext';

/** 非阻塞提示条：替代原生 alert。 */
export const notify = {
  success: (message: string, description?: string) => toast.success(message, { description }),
  error: (message: string, description?: string) => toast.error(message, { description }),
  info: (message: string, description?: string) => toast.info(message, { description }),
  warning: (message: string, description?: string) => toast.warning(message, { description }),
};

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作（删除、清空等）使用醒目的破坏性样式 */
  destructive?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  inputType?: 'text' | 'password';
}

type PendingRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

interface FeedbackApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

/**
 * 提供 Promise 式确认与输入对话框：替代原生 confirm / prompt。
 * Esc、点击遮罩或取消均视为“取消”（confirm 返回 false，prompt 返回 null）。
 */
export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useLanguage();
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [inputValue, setInputValue] = useState('');
  const settledRef = useRef(true);

  const settle = useCallback((accepted: boolean) => {
    setRequest(current => {
      if (current && !settledRef.current) {
        settledRef.current = true;
        if (current.kind === 'confirm') current.resolve(accepted);
        else current.resolve(accepted ? inputValue : null);
      }
      return null;
    });
  }, [inputValue]);

  const open = useCallback((next: PendingRequest) => {
    setRequest(current => {
      // 新请求到来时，未完成的旧请求按取消处理，保证每个 Promise 都会被兑现
      if (current && !settledRef.current) {
        if (current.kind === 'confirm') current.resolve(false);
        else current.resolve(null);
      }
      settledRef.current = false;
      return next;
    });
  }, []);

  const api = React.useMemo<FeedbackApi>(() => ({
    confirm: options => new Promise<boolean>(resolve => open({ kind: 'confirm', options, resolve })),
    prompt: options => new Promise<string | null>(resolve => {
      setInputValue(options.defaultValue ?? '');
      open({ kind: 'prompt', options, resolve });
    }),
  }), [open]);

  const options = request?.options;
  const isPrompt = request?.kind === 'prompt';
  const promptOptions = isPrompt ? (request.options as PromptOptions) : null;

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <AlertDialog open={request !== null} onOpenChange={next => { if (!next) settle(false); }}>
        <AlertDialogContent>
          <form
            className="contents"
            onSubmit={event => {
              event.preventDefault();
              settle(true);
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{options?.title}</AlertDialogTitle>
              {options?.description && <AlertDialogDescription className="whitespace-pre-line break-words">{options.description}</AlertDialogDescription>}
            </AlertDialogHeader>
            {promptOptions && (
              <div className="grid gap-2">
                {promptOptions.label && <Label htmlFor="feedback-prompt-input">{promptOptions.label}</Label>}
                <Input
                  id="feedback-prompt-input"
                  autoFocus
                  type={promptOptions.inputType ?? 'text'}
                  placeholder={promptOptions.placeholder}
                  value={inputValue}
                  onChange={event => setInputValue(event.target.value)}
                />
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button">{options?.cancelText ?? t('cancel')}</AlertDialogCancel>
              <AlertDialogAction type="submit" variant={options?.destructive ? 'destructive' : 'default'}>
                {options?.confirmText ?? (isPrompt ? t('save') : t('confirm_action'))}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </FeedbackContext.Provider>
  );
};

export const useFeedback = (): FeedbackApi => {
  const api = useContext(FeedbackContext);
  if (!api) throw new Error('useFeedback 必须在 ConfirmProvider 内使用');
  return api;
};
