// import node module libraries
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

// import app config file
import { settings } from "app.config";

export type MenuToggleType = "expanded" | "collapsed";

interface initialStateType {
  skin: string;
  showMenu: boolean;
  collapsed: MenuToggleType;
}

const initialState: initialStateType = {
  skin: settings.theme.skin,
  showMenu: true,
  collapsed: "expanded",
};
const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    changeSkin: (state, action) => {
      state.skin = action.payload;
    },
    toggleMenu: (state, action: PayloadAction<{ showMenu: boolean }>) => {
      state.showMenu = action.payload.showMenu;
    },
    setCollapsed: (state, action: PayloadAction<{ value: MenuToggleType }>) => {
      document
        .querySelector("html")
        ?.setAttribute("class", action.payload.value),
        (state.collapsed = action.payload.value);
    },
  },
});

export const { changeSkin, toggleMenu, setCollapsed } = appSlice.actions;

export default appSlice.reducer;
