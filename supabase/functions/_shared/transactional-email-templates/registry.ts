/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as newBookingNotification } from './new-booking-notification.tsx'
import { template as bookingConfirmation } from './booking-confirmation.tsx'
import { template as trialBookingConfirmation } from './trial-booking-confirmation.tsx'
import { template as bookingCancellation } from './booking-cancellation.tsx'
import { template as newAccountNotification } from './new-account-notification.tsx'
import { template as trialBookingReminder } from './trial-booking-reminder.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'new-booking-notification': newBookingNotification,
  'booking-confirmation': bookingConfirmation,
  'trial-booking-confirmation': trialBookingConfirmation,
  'booking-cancellation': bookingCancellation,
  'new-account-notification': newAccountNotification,
  'trial-booking-reminder': trialBookingReminder,
}
