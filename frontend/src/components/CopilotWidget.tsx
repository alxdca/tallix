import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { askCopilot, type CopilotAnswer, type ConversationMessage } from '../api';

interface Message {
  id: string;
  type: 'question' | 'answer';
  content: string;
  answer?: CopilotAnswer;
  timestamp: Date;
}

const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 540;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const DEFAULT_BOTTOM = 90;
const DEFAULT_RIGHT = 20;

export default function CopilotWidget() {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelSize, setPanelSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [panelPosition, setPanelPosition] = useState({ bottom: DEFAULT_BOTTOM, right: DEFAULT_RIGHT });
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const dragStartRef = useRef({ x: 0, y: 0, bottom: 0, right: 0 });

  const suggestions = useMemo(() => {
    return [
      t('copilot.suggestionOverspend'),
      t('copilot.suggestionChange'),
      t('copilot.suggestionYtd'),
    ];
  }, [t]);

  // Auto-scroll to bottom when new message is added
  useEffect(() => {
    if (messages.length > 0 && isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isOpen]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        // Check if click is on the toggle button
        const toggleButton = document.querySelector('.copilot-widget-toggle');
        if (toggleButton?.contains(event.target as Node)) {
          return;
        }
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Handle resize from top-left corner
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: panelSize.width,
      height: panelSize.height,
    };
  }, [panelSize]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // For top-left resize: moving left increases width, moving up increases height
      const deltaX = resizeStartRef.current.x - e.clientX;
      const deltaY = resizeStartRef.current.y - e.clientY;

      const newWidth = Math.max(MIN_WIDTH, Math.min(resizeStartRef.current.width + deltaX, window.innerWidth - 40));
      const newHeight = Math.max(MIN_HEIGHT, Math.min(resizeStartRef.current.height + deltaY, window.innerHeight - 120));

      setPanelSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Handle drag from header
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Don't start drag if clicking on buttons
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      bottom: panelPosition.bottom,
      right: panelPosition.right,
    };
  }, [panelPosition]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Moving right decreases "right", moving down decreases "bottom"
      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;

      const newRight = Math.max(0, Math.min(dragStartRef.current.right - deltaX, window.innerWidth - panelSize.width));
      const newBottom = Math.max(0, Math.min(dragStartRef.current.bottom - deltaY, window.innerHeight - panelSize.height));

      setPanelPosition({ bottom: newBottom, right: newRight });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, panelSize.width, panelSize.height]);

  const handleAsk = async (questionText: string) => {
    if (!questionText.trim() || isLoading) {
      return;
    }

    const trimmedQuestion = questionText.trim();
    setQuestion('');
    setError(null);

    // Add user question to messages
    const questionMessage: Message = {
      id: `q-${Date.now()}`,
      type: 'question',
      content: trimmedQuestion,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, questionMessage]);
    setIsLoading(true);

    try {
      // Extract recent conversation history (last 5 Q&A pairs = 10 messages)
      const recentMessages = messages.slice(-10);
      const conversationHistory: ConversationMessage[] = recentMessages.map((msg) => ({
        role: msg.type === 'question' ? 'user' : 'assistant',
        content: msg.type === 'question' ? msg.content : msg.answer?.summary || msg.content,
      }));

      const answer = await askCopilot(trimmedQuestion, conversationHistory);

      // Add answer to messages
      const answerMessage: Message = {
        id: `a-${Date.now()}`,
        type: 'answer',
        content: answer.summary,
        answer,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, answerMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get answer');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleAsk(question);
  };

  const handleSuggestionClick = (suggestion: string) => {
    handleAsk(suggestion);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleClearHistory = () => {
    setMessages([]);
    setError(null);
  };

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <div className="copilot-widget">
      {/* Toggle Button */}
      <button
        type="button"
        className="copilot-widget-toggle"
        onClick={handleToggle}
        aria-label={isOpen ? t('copilot.close') : t('copilot.title')}
      >
        {isOpen ? (
          // X icon when open
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          // Chat bubble icon when closed
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div
          className={`copilot-widget-panel ${isResizing || isDragging ? 'interacting' : ''}`}
          ref={panelRef}
          style={{
            width: panelSize.width,
            height: panelSize.height,
            bottom: panelPosition.bottom,
            right: panelPosition.right,
          }}
        >
          {/* Top-left resize handle */}
          <div
            className="copilot-widget-resize-handle"
            onMouseDown={handleResizeStart}
          />
          <div
            className="copilot-widget-header"
            onMouseDown={handleDragStart}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            <div className="copilot-widget-title">
              <h3>{t('copilot.title')}</h3>
              <p>{t('copilot.subtitle')}</p>
            </div>
            <div className="copilot-widget-actions">
              {messages.length > 0 && (
                <button
                  type="button"
                  className="copilot-widget-clear"
                  onClick={handleClearHistory}
                  title={t('copilot.clearHistory')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className="copilot-widget-close"
                onClick={() => setIsOpen(false)}
                aria-label={t('copilot.close')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="copilot-widget-body">
            {messages.length === 0 ? (
              <div className="copilot-widget-empty">
                <h4>{t('copilot.noAnswerTitle')}</h4>
                <p>{t('copilot.noAnswerSubtitle')}</p>
                <div className="copilot-widget-suggestions">
                  {suggestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="copilot-widget-chip"
                      onClick={() => handleSuggestionClick(item)}
                      disabled={isLoading}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="copilot-widget-messages">
                {messages.map((msg) => (
                  <div key={msg.id} className={`copilot-widget-message copilot-widget-message-${msg.type}`}>
                    {msg.type === 'question' ? (
                      <div className="copilot-widget-question">
                        <strong>{t('copilot.you')}:</strong> {msg.content}
                      </div>
                    ) : (
                      <div className="copilot-widget-answer">
                        <div className="copilot-widget-answer-summary">
                          <strong>{t('copilot.tallix')}:</strong> {msg.content}
                        </div>
                        {msg.answer && !msg.answer.isFallback && msg.answer.why.length > 0 && (
                          <div className="copilot-widget-why">
                            <div className="copilot-widget-why-title">{t('copilot.why')}</div>
                            <ul className="copilot-widget-why-list">
                              {msg.answer.why.map((item, idx) => (
                                <li key={idx}>
                                  {item.reason}
                                  {item.value !== undefined && item.metric && (
                                    <span className="copilot-widget-metric">
                                      {' '}({item.metric}: {item.value})
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {msg.answer?.isFallback && msg.answer.why.length > 0 && (
                          <div className="copilot-widget-suggestions-inline">
                            <div className="copilot-widget-suggestions-inline-title">
                              {t('copilot.tryTheseQuestions')}:
                            </div>
                            <ul className="copilot-widget-suggestions-inline-list">
                              {msg.answer.why.map((item, idx) => (
                                <li key={idx}>
                                  <button
                                    type="button"
                                    className="copilot-widget-suggestion-link"
                                    onClick={() => handleAsk(item.reason)}
                                    disabled={isLoading}
                                  >
                                    {item.reason}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {msg.answer && (
                          <div className="copilot-widget-confidence">
                            {t('copilot.confidence')}: {msg.answer.confidence}
                            {' • '}
                            {(msg.answer.latencyMs / 1000).toFixed(1)}s
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {error && (
            <div className="copilot-widget-error">
              {error}
            </div>
          )}

          <div className="copilot-widget-input">
            <form onSubmit={handleSubmit}>
              <textarea
                className="copilot-widget-textarea"
                rows={2}
                placeholder={t('copilot.placeholder')}
                disabled={isLoading}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                type="submit"
                className="copilot-widget-submit"
                disabled={isLoading || !question.trim()}
              >
                {isLoading ? (
                  <svg className="copilot-widget-spinner" width="20" height="20" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
