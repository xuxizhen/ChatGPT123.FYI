import type { ChatMessage } from '@/types'
import { createSignal, Index, Show } from 'solid-js'
import IconClear from './icons/Clear'
import MessageItem from './MessageItem'
import SystemRoleSettings from './SystemRoleSettings'
import _ from 'lodash'
import { generateSignature } from '@/utils/auth'

export default () => {
  let inputRef: HTMLTextAreaElement
  const [currentSystemRoleSettings, setCurrentSystemRoleSettings] = createSignal('')
  const [systemRoleEditing, setSystemRoleEditing] = createSignal(false)
  const [messageList, setMessageList] = createSignal<ChatMessage[]>([])
  const [currentAssistantMessage, setCurrentAssistantMessage] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [controller, setController] = createSignal<AbortController>(null)

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  const currentDay = currentDate.getDate();
  const DATA_STR = `${currentYear}${currentMonth}${currentDay}`;
  const [count, setCount] = createSignal(Number(localStorage[DATA_STR] || 0));
  const handleButtonClick = async () => {
    const inputValue = inputRef.value
    if (!inputValue) {
      return
    }
    // @ts-ignore
    if (window?.umami) umami.trackEvent('chat_generate')
    inputRef.value = ''
    setMessageList([
      ...messageList(),
      {
        role: 'user',
        content: inputValue,
      },
    ])
    requestWithLatestMessage()
  }
  const throttle =_.throttle(function(){
    window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'})
  }, 300, {
    leading: true,
    trailing: false
  })
  const requestWithLatestMessage = async () => {
    if (count() > 9 || messageList().length > 7){
      return
    }
    setLoading(true)
    setCurrentAssistantMessage('')
    try {
      const controller = new AbortController()
      setController(controller)
      const requestMessageList = [...messageList()]
      if (currentSystemRoleSettings()) {
        requestMessageList.unshift({
          role: 'system',
          content: currentSystemRoleSettings(),
        })
      }
      const timestamp = Date.now()
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          messages: requestMessageList,
          time: timestamp,
          sign: await generateSignature({
            t: timestamp,
            m: requestMessageList?.[requestMessageList.length - 1]?.content || '',
          }),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(response.statusText)
      }
      setCount(count() + 1);
      localStorage[DATA_STR] = count();
      const data = response.body
      if (!data) {
        throw new Error('No data')
      }
      const reader = data.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (value) {
          let char = decoder.decode(value)
          if (char === '\n' && currentAssistantMessage().endsWith('\n')) {
            continue
          }
          if (char) {
            setCurrentAssistantMessage(currentAssistantMessage() + char)
          }
          throttle()
        }
        done = readerDone
      }
    } catch (e) {
      console.error(e)
      setLoading(false)
      setController(null)
      return
    }
    archiveCurrentMessage()
  }

  const archiveCurrentMessage = () => {
    if (currentAssistantMessage()) {
      setMessageList([
        ...messageList(),
        {
          role: 'assistant',
          content: currentAssistantMessage(),
        },
      ])
      setCurrentAssistantMessage('')
      setLoading(false)
      setController(null)
      inputRef.focus()
    }
  }

  const clear = () => {
    inputRef.value = ''
    inputRef.style.height = 'auto';
    setMessageList([])
    setCurrentAssistantMessage('')
    setCurrentSystemRoleSettings('')
  }

  const stopStreamFetch = () => {
    if (controller()) {
      controller().abort()
      archiveCurrentMessage()
    }
  }

  const retryLastFetch = () => {
    if (messageList().length > 0) {
      const lastMessage = messageList()[messageList().length - 1]
      console.log(lastMessage)
      if (lastMessage.role === 'assistant') {
        setMessageList(messageList().slice(0, -1))
        requestWithLatestMessage()
      }
    }
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.isComposing || e.shiftKey) {
      return
    }
    if (e.key === 'Enter') {
      handleButtonClick()
    }
  }

  return (
    <div my-6>
      <SystemRoleSettings
        canEdit={() => messageList().length === 0}
        systemRoleEditing={systemRoleEditing}
        setSystemRoleEditing={setSystemRoleEditing}
        currentSystemRoleSettings={currentSystemRoleSettings}
        setCurrentSystemRoleSettings={setCurrentSystemRoleSettings}
      />
      <Index each={messageList()}>
        {(message, index) => (
          <MessageItem
            role={message().role}
            message={message().content}
            showRetry={() => (message().role === 'assistant' && index === messageList().length - 1)}
            onRetry={retryLastFetch}
          />
        )}
      </Index>
      {currentAssistantMessage() && (
        <MessageItem
          role="assistant"
          message={currentAssistantMessage}
        />
      )}
      {count() > 9 && (
        <div class="py-2 -mx-4 px-4 transition-colors md:hover:bg-slate/3">
          <div class="flex gap-3 rounded-lg">
            <div class="shrink-0 w-7 h-7 mt-4 rounded-full op-80 ">
              <img src="/favicon.svg" />
            </div>
            <div class="message prose break-words overflow-hidden">
              <p>Error:</p>
              <p>
                Due to cost reasons, we have some limitations for free users.
              </p>
              <p>You have reached your daily limits.</p>
              <p>因成本原因我们对免费用户做了消息限制，你的今日额度已用完。</p>
            </div>
          </div>
        </div>
      )}
      {messageList().length > 7 && (
        <div class="py-2 -mx-4 px-4 transition-colors md:hover:bg-slate/3">
          <div class="flex gap-3 rounded-lg">
            <div class="shrink-0 w-7 h-7 mt-4 rounded-full op-80 ">
              <img src="/favicon.svg" />
            </div>
            <div class="message prose break-words overflow-hidden">
              <pre>
                <code class="hljs">
                  Too many context messages, please clear the messages and try
                  again. <br />
                  上下文消息过多，请清除消息后重试。
                </code>
              </pre>
            </div>
          </div>
        </div>
      )}
      <Show
        when={!loading()}
        fallback={() => (
          <div class="h-12 my-4 flex gap-4 items-center justify-center bg-slate bg-op-15 rounded-sm">
            <span>AI is thinking...</span>
            <div class="px-2 py-0.5 border border-slate rounded-md text-sm op-70 cursor-pointer hover:bg-slate/10" onClick={stopStreamFetch}>Stop</div>
          </div>
        )}
      >
        <div class="my-4 flex items-center gap-2 transition-opacity" class:op-50={systemRoleEditing()}>
          <textarea
            ref={inputRef!}
            disabled={systemRoleEditing()}
            onKeyDown={handleKeydown}
            placeholder="Enter something..."
            autocomplete="off"
            autofocus
            onInput={() => {
              inputRef.style.height = 'auto';
              inputRef.style.height = inputRef.scrollHeight + 'px';
            }}
            rows="1"
            w-full
            px-3 py-3
            min-h-12
            max-h-36
            rounded-sm
            bg-slate
            bg-op-15
            resize-none
            focus:bg-op-20
            focus:ring-0
            focus:outline-none
            placeholder:op-50
            dark="placeholder:op-30"
            scroll-pa-8px
          />
          <button onClick={handleButtonClick} disabled={systemRoleEditing()} h-12 px-4 py-2 bg-slate bg-op-15 hover:bg-op-20 rounded-sm>
            Send
          </button>
          <button title="Clear" onClick={clear} disabled={systemRoleEditing()} h-12 px-4 py-2 bg-slate bg-op-15 hover:bg-op-20 rounded-sm>
            <IconClear />
          </button>
        </div>
      </Show>
    </div>
  )
}
