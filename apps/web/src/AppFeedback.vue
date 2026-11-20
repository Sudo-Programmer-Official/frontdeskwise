<script setup lang="ts">
export type AppToastKind = "success" | "error" | "warning" | "info";

export interface AppToast {
  id: number;
  kind: AppToastKind;
  title: string;
  message: string;
}

defineProps<{
  loading: boolean;
  toasts: AppToast[];
}>();

const emit = defineEmits<{
  dismiss: [id: number];
}>();

const toastIcons: Record<AppToastKind, string> = {
  success: "✓",
  error: "!",
  warning: "!",
  info: "i",
};
</script>

<template>
  <Teleport to="body">
    <Transition name="feedback-loader">
      <div
        v-if="loading"
        class="app-loading-overlay"
        role="status"
        aria-live="polite"
        aria-label="Loading"
      >
        <span class="app-loading-spinner" aria-hidden="true"></span>
      </div>
    </Transition>

    <div class="app-toast-region" aria-live="polite" aria-atomic="false">
      <TransitionGroup name="feedback-toast">
        <article
          v-for="toast in toasts"
          :key="toast.id"
          :class="['app-toast', `app-toast-${toast.kind}`]"
          role="status"
        >
          <span class="app-toast-icon" aria-hidden="true">{{ toastIcons[toast.kind] }}</span>
          <div class="app-toast-copy">
            <strong>{{ toast.title }}</strong>
            <p>{{ toast.message }}</p>
          </div>
          <button
            class="app-toast-close"
            type="button"
            aria-label="Dismiss notification"
            @click="emit('dismiss', toast.id)"
          >
            ×
          </button>
        </article>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
