<script setup lang="ts">
withDefaults(defineProps<{
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "small";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
}>(), {
  variant: "secondary",
  size: "default",
  type: "button",
});
</script>

<template>
  <button :type="type" :class="['ds-button', `ds-button-${variant}`, { 'ds-button-small': size === 'small' }]" :disabled="disabled">
    <slot />
  </button>
</template>
