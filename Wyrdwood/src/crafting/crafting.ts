import type { Inventory } from '../items/inventory';
import type { PlacedObjects } from '../building/placed';
import { RECIPES, STATION_RANGE, type Recipe } from '../data/recipes';

/** Crafting rules: recipe availability (station proximity) + execution. */
export class Crafting {
  /** Called after each successful craft (XP hooks). */
  onCraft: (recipe: Recipe) => void = () => {};

  constructor(
    private inventory: Inventory,
    private placed: PlacedObjects,
  ) {}

  /** Is the required station nearby (or none needed)? */
  stationOk(recipe: Recipe, px: number, pz: number): boolean {
    if (!recipe.station) return true;
    return this.placed.nearest(recipe.station, px, pz, STATION_RANGE) !== null;
  }

  haveIngredients(recipe: Recipe): boolean {
    return recipe.ingredients.every((ing) => this.inventory.count(ing.itemId) >= ing.count);
  }

  canCraft(recipe: Recipe, px: number, pz: number): boolean {
    return this.stationOk(recipe, px, pz) && this.haveIngredients(recipe);
  }

  /** Craft if possible. Returns true on success. */
  craft(recipe: Recipe, px: number, pz: number): boolean {
    if (!this.canCraft(recipe, px, pz)) return false;
    for (const ing of recipe.ingredients) this.inventory.remove(ing.itemId, ing.count);
    this.inventory.add(recipe.output, recipe.count);
    this.onCraft(recipe);
    return true;
  }

  get recipes(): Recipe[] {
    return RECIPES;
  }

  /** How many of an item the player has (for UI have/need displays). */
  count(itemId: string): number {
    return this.inventory.count(itemId);
  }
}
