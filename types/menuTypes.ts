export interface CustomToggleType {
  children: React.ReactNode;
  eventKey: string;
  icon?: React.ReactNode;
  callback?: () => void;
}

export interface MenuItemType {
  id: string;
  title?: string;
  name?: string;
  link?: string;
  icon?: React.ReactNode;
  grouptitle?: boolean;
  badge?: string;
  badgecolor?: string;
  children?: MenuItemType[];
}
