import "reflect-metadata";
import { Controller, Get, Module, Param, Query } from "@nestjs/common";
import { DemoService } from "./service";
@Controller("api")
class ApiController {
  private service = new DemoService();
  @Get("health") health() {
    return {
      status: "ok",
      mode: "demo",
      version: "0.1.0",
      authentication: "demo-only",
    };
  }
  @Get("scenes") scenes() {
    return this.service.scenes();
  }
  @Get("scenes/:id/layers") layers(@Param("id") id: string) {
    return this.service.layers(id);
  }
  @Get("scenes/:id/stations") stations(@Param("id") id: string) {
    return this.service.stations(id);
  }
  @Get("layers/:id/times") times(@Param("id") id: string) {
    return this.service.times(id);
  }
  @Get("layers/:id/data") data(
    @Param("id") id: string,
    @Query("sceneId") sceneId: string,
    @Query("time") time: string,
  ) {
    return this.service.data(id, sceneId, time);
  }
  @Get("search") search(@Query("sceneId") sceneId: string, @Query("q") q = "") {
    return this.service.search(sceneId, q);
  }
}
@Module({ controllers: [ApiController] })
export class AppModule {}
