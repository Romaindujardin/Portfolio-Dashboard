// Exécuté avant chaque fichier de test : isole le localStorage entre chaque test.
import "./shims";
import { beforeEach } from "vitest";
import { resetAppStorage } from "./shims";

beforeEach(() => {
  resetAppStorage();
});
