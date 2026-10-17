interface MobileAppParameter {
  name: string;
  description: string;
  required?: boolean;
  defaultValue?: string;
}

interface MobileAppActionIntent {
  action?: string;
  uriTemplate?: string;
  component?: string;
  category?: string;
  flags?: string[];
  extraParams?: Record<string, string>;
}

export interface MobileAppAction {
  id: string;
  displayName: string;
  description: string;
  intent: MobileAppActionIntent;
  parameters?: MobileAppParameter[];
}

export interface MobileAppDefinition {
  id: string;
  displayName: string;
  packageName: string;
  defaultActionId?: string;
  actions: Record<string, MobileAppAction>;
}
