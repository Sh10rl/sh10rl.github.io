# frozen_string_literal: true

source "https://rubygems.org"

# --- 必须包含的行 (根据之前的解决方案) ---
gem "jekyll", "~> 4.3.3"  # 添加这一行来指定 Jekyll 版本
gem "jekyll-theme-chirpy", "~> 7.2.4", github: "cotes2020/jekyll-theme-chirpy" # 修正这一行，指定版本和 GitHub 来源
# --- 结束必须包含的行 ---

gem "html-proofer", "~> 5.0", group: :test

platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end

gem "wdm", "~> 0.2.0", :platforms => [:mingw, :x64_mingw, :mswin]
